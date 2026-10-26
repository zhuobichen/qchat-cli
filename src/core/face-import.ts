import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { basename, dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { CustomFaceDetail, OneBotClient } from './onebot-client.js';

/**
 * 项目根目录。
 *
 * ⚠️ 这里刻意**不用** `resolve('private/...')`——那是相对**当前工作目录**解析的，
 * 从别处运行 `qce` 会指到错误的目录（`emoji-library.ts` 就有这个隐患）。
 * 从本文件位置往上两级才是稳的。
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER_PATH = resolve(PROJECT_ROOT, 'private/face-import-ledger.json');

/** 与 `emoji-library.ts` 的 `ALLOWED` 保持一致。QQ 收藏表情主要吃这几种。 */
const ALLOWED = new Set(['.jpg', '.jpeg', '.gif', '.png', '.webp']);
/** 与 `emoji-library.ts` 一致的上限。 */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * 每张之间的间隔。
 *
 * 项目既有约定是批量请求间隔 200-300ms（`USAGE.md` / `HANDOVER.md`），这里取上限，
 * 因为**这是在改 QQ 账号状态**，比拉数据更容易触发风控。
 */
const DEFAULT_INTERVAL_MS = 300;

/** 命中限流的冷却时间。项目里 `-10000` 的既有经验是 15-30 分钟，取中间值。 */
const RATE_LIMIT_COOLDOWN_MS = 20 * 60 * 1000;

interface Ledger {
  version: 1;
  /** 内容 md5 -> 导入成功时间（ISO）。这是断点续跑的唯一依据。 */
  imported: Record<string, string>;
}

export interface ScannedFile {
  path: string;
  name: string;
  bytes: number;
  md5: string;
  extension: string;
}

export interface ImportResult {
  added: number;
  /** 本地账本里已有，或 QQ 收藏里已有 —— 没重复导 */
  skipped: number;
  failed: Array<{ file: string; error: string }>;
  /** 是否因限流中止 */
  abortedByRateLimit: boolean;
}

function loadLedger(): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, 'utf-8')) as Ledger;
    if (parsed && parsed.version === 1 && parsed.imported) return parsed;
  } catch {
    // 账本不存在或损坏都当空的——重新导入的代价只是可能重复，不该让命令直接挂掉
  }
  return { version: 1, imported: {} };
}

/** 原子写：临时文件 + rename，和 `emoji-library.ts` 的 manifest 一个做法。 */
function saveLedger(ledger: Ledger): void {
  const dir = dirname(LEDGER_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${LEDGER_PATH}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(ledger, null, 2), { encoding: 'utf-8', mode: 0o600 });
  renameSync(temp, LEDGER_PATH);
}

/** 扫目录，只收白名单内的图片，跳过大文件。 */
export function scanDirectory(dir: string, limit?: number): ScannedFile[] {
  const absolute = resolve(dir);
  if (!existsSync(absolute)) throw new Error(`目录不存在: ${absolute}`);
  const entries = readdirSync(absolute, { withFileTypes: true })
    .filter((item) => item.isFile() && ALLOWED.has(extname(item.name).toLowerCase()));
  const out: ScannedFile[] = [];
  for (const entry of entries) {
    const path = resolve(absolute, entry.name);
    const bytes = readFileSync(path);
    if (bytes.length > MAX_BYTES) continue; // 太大的跳过，和 emoji-library 一致
    out.push({
      path,
      name: entry.name,
      bytes: bytes.length,
      md5: createHash('md5').update(bytes).digest('hex'),
      extension: extname(entry.name).toLowerCase(),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name)); // 顺序稳定，方便断点续跑时对照
  return limit && limit > 0 ? out.slice(0, limit) : out;
}

/**
 * 从 QQ 收藏里取「已存在」的 md5 集合，用于跳过。
 *
 * 去重键是 `md5`（实测确认）。**注意大小写**：接口返回的是**大写**十六进制，
 * 本地 `createHash('md5')` 出来的是**小写**，所以这里统一 `toLowerCase()`。
 *
 * 拿不到就返回空集合——那样只会导致"可能重复导入"，**不会误跳过用户的图**。
 * 这个方向的不对称是故意的：漏导比误跳过的代价小。
 */
export async function existingFaceKeys(client: OneBotClient): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const list: CustomFaceDetail[] = await client.fetchCustomFaceDetail(2000);
    for (const item of list ?? []) {
      const md5 = typeof item?.md5 === 'string' ? item.md5.trim().toLowerCase() : '';
      if (md5) keys.add(md5);
    }
  } catch {
    // 查不到就当没有——不阻塞导入
  }
  return keys;
}

function isRateLimited(error: unknown): boolean {
  const text = String((error as Error)?.message ?? error);
  return /-10000|限流|rate.?limit|too many/i.test(text);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 把目录里的图批量加进 QQ 收藏表情。
 *
 * 三条硬约束：
 * 1. **串行**，每张之间 sleep —— 不并发。这是在改账号状态，快不是目标。
 * 2. **每成功一张立刻落盘账本** —— 中途 Ctrl-C 或被限流，重跑只补没成功的。
 * 3. **失败不中断** —— 记进 `failed[]` 继续下一张；只有限流才整批停下。
 */
export async function importFaces(
  client: OneBotClient,
  dir: string,
  options: {
    intervalMs?: number;
    limit?: number;
    /** 是否在导入前拉一次 QQ 现有收藏做查重（默认 true） */
    checkExisting?: boolean;
    onProgress?: (text: string) => void;
  } = {}
): Promise<ImportResult> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const files = scanDirectory(dir, options.limit);
  const ledger = loadLedger();
  const result: ImportResult = { added: 0, skipped: 0, failed: [], abortedByRateLimit: false };

  // 前置连通性检查。
  // ⚠️ 不能省：`request()` 自带 3 次重试（间隔 1s），NapCat 没跑的话**每一张**都要白等
  // 3 秒才失败，200 张就是十几分钟的无效重试。先探一次，连不上就直接抛。
  try {
    await client.getLoginInfo();
  } catch (error) {
    throw new Error(
      `连不上 NapCat（导入前检查失败）: ${String((error as Error)?.message ?? error)}`
    );
  }

  const existing = options.checkExisting === false ? new Set<string>() : await existingFaceKeys(client);

  let index = 0;
  for (const file of files) {
    index += 1;
    const tag = `[${index}/${files.length}] ${file.name}`;

    // ① 本地账本：这次或上次已经导成功过
    if (ledger.imported[file.md5]) {
      result.skipped += 1;
      options.onProgress?.(`${tag} — 跳过（账本已有）`);
      continue;
    }
    // ② QQ 收藏里已经有同 md5 的（尽力而为）
    if (existing.has(file.md5.toLowerCase())) {
      result.skipped += 1;
      ledger.imported[file.md5] = new Date().toISOString(); // 补记，下次就不用再查
      saveLedger(ledger);
      options.onProgress?.(`${tag} — 跳过（收藏里已有）`);
      continue;
    }

    options.onProgress?.(`${tag} — 导入中…`);
    try {
      await client.addCustomFace(file.path, { isOrigin: true });
      ledger.imported[file.md5] = new Date().toISOString();
      saveLedger(ledger); // ← 立刻落盘，这是断点续跑的关键
      result.added += 1;
      options.onProgress?.(`${tag} — 成功`);
    } catch (error) {
      if (isRateLimited(error)) {
        result.abortedByRateLimit = true;
        options.onProgress?.(
          `${tag} — 命中限流，整批停止。建议等 ${Math.round(RATE_LIMIT_COOLDOWN_MS / 60000)} 分钟后再跑，` +
            `已成功的 ${result.added} 张记在账本里，重跑会自动跳过。`
        );
        break;
      }
      result.failed.push({ file: file.name, error: String((error as Error)?.message ?? error) });
      options.onProgress?.(`${tag} — 失败（继续下一张）`);
    }
    await sleep(intervalMs);
  }

  return result;
}

/** 供 CLI 判断目录是否可用，避免把异常丢到栈里。 */
export function describeDirectory(dir: string): { ok: boolean; message: string; count: number } {
  try {
    const files = scanDirectory(dir);
    const mb = files.reduce((sum, f) => sum + f.bytes, 0) / 1024 / 1024;
    return {
      ok: files.length > 0,
      count: files.length,
      message: files.length
        ? `${files.length} 张可用图片，共 ${mb.toFixed(1)} MB`
        : '目录里没有可用的图片（支持 .jpg/.jpeg/.gif/.png/.webp，且单张 ≤5MB）',
    };
  } catch (error) {
    return { ok: false, count: 0, message: String((error as Error)?.message ?? error) };
  }
}

export { LEDGER_PATH, PROJECT_ROOT, DEFAULT_INTERVAL_MS };
