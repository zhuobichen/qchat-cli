/**
 * 真机集成测试：验证「授权链 → OneBot → 消息落库」这条完整路径。
 *
 * 与单元测试的区别：单元测试用内存 store 验证判定矩阵，这里打的是真实 NapCat。
 *
 * 前置条件（缺一个就跳过并说明原因）：
 *   1. NapCat 已启动，OneBot HTTP 已启用（onebot11_<qq>.json 里 network.httpServers 非空）
 *   2. 已登录（get_login_info 返回有效 user_id）
 *   3. 指定一个**安全测试目标**：QCE_IT_TARGET=<QQ号或群号>，且已在白名单
 *   4. 显式同意发消息：QCE_IT_ALLOW=1
 *
 * 用法：
 *   QCE_IT_ALLOW=1 QCE_IT_TARGET=123456789 npx tsx scripts/integration-onebot.ts
 *
 * 注意：会真的发一条带标记的消息到目标会话（标记可检索，便于撤回）。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const TARGET = process.env.QCE_IT_TARGET;
const ALLOW = process.env.QCE_IT_ALLOW === '1';
const MARK = `[qce-it ${randomUUID().slice(0, 8)}]`;

function qce(args: string[]): string {
  try {
    return execFileSync('npx', ['tsx', 'src/cli.ts', ...args], {
      encoding: 'utf-8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e: any) {
    return String(e?.stdout ?? '') + String(e?.stderr ?? '');
  }
}

function need(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`跳过：${msg}`);
    process.exit(2);
  }
}

need(ALLOW, '未设置 QCE_IT_ALLOW=1（防止误发真实消息）');
need(Boolean(TARGET), '未设置 QCE_IT_TARGET（测试目标 QQ 号/群号）');

// 1. 连通性：拿不到登录信息就说明 OneBot 没起来 / 没登录
const status = qce(['login', '--test']);
need(/成功|ok|已连接|user_id/i.test(status) && !/失败|拒绝|refused|ECONN/i.test(status),
  `OneBot 未就绪：\n${status.slice(0, 400)}`);

const results: Array<[string, boolean, string]> = [];

// 2. 未授权目标必须被拒（这是最该守住的边界）
const denied = qce(['send', 'msg', '10000', 'unauthorized probe']);
results.push(['未授权目标被拒绝', /未获发送授权|未授权/.test(denied), denied.trim().slice(0, 80)]);

// 3. 关闭全局开关后，即使白名单内的目标也必须被拒
qce(['safety', 'disable']);
const off = qce(['send', 'msg', String(TARGET), 'switch off probe']);
results.push(['全局开关关闭时被拒绝', /未获发送授权|请先启用/.test(off), off.trim().slice(0, 80)]);
qce(['safety', 'enable']);

// 4. 授权目标：真发一条带标记的消息
const sent = qce(['send', 'msg', String(TARGET), MARK, '--force']);
results.push(['授权目标发送成功', /已发送/.test(sent), sent.trim().slice(0, 80)]);

// 5. 回读验证：消息确实落到会话里（而不是只有 CLI 说成功）
const back = qce(['export', String(TARGET), '--format', 'json', '--limit', '5']);
results.push(['消息可回读（标记命中）', back.includes(MARK), `标记 ${MARK}`]);

let failed = 0;
for (const [name, ok, detail] of results) {
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `  → ${detail}`}`);
  if (!ok) failed++;
}
console.log(`\n结果：${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
