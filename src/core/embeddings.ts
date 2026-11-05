/**
 * 向量化 + 余弦相似度（阿里云百炼 text-embedding-v4，OpenAI 兼容端点）。
 *
 * 纯计算部分（余弦、Float32 ⇄ base64、分批）与网络调用分开，
 * 便于在没有 key 的环境里单测。
 */

export const DEFAULT_EMBEDDING_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4';
export const EMBEDDING_DIM = 1024;

export interface EmbeddingConfig {
  apiKey: string;
  endpoint?: string;
  model?: string;
  batchSize?: number;
}

/** 两个向量的余弦相似度；长度不一致或零向量返回 0 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Float32Array → base64（紧凑存盘） */
export function encodeVector(vec: ArrayLike<number>): string {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
}

/** base64 → Float32Array */
export function decodeVector(text: string): Float32Array {
  const buf = Buffer.from(text, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/** 把数组按 batch 切分 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const step = Math.max(1, size);
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

type FetchLike = typeof fetch;

/**
 * 批量取 embedding。失败重试一次，仍失败则抛错（调用方决定降级）。
 */
export async function embedTexts(
  texts: string[],
  config: EmbeddingConfig,
  fetchImpl: FetchLike = fetch,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!config.apiKey) throw new Error('缺少 embedding API key');

  const endpoint = config.endpoint || DEFAULT_EMBEDDING_ENDPOINT;
  const model = config.model || DEFAULT_EMBEDDING_MODEL;
  const batchSize = Math.min(Math.max(config.batchSize ?? 10, 1), 25);
  const out: number[][] = [];

  for (const batch of chunk(texts, batchSize)) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: batch }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const json: any = await res.json();
        const vectors = (json?.data ?? []).map((d: any) => d.embedding as number[]);
        if (vectors.length !== batch.length) throw new Error(`返回数量不符: ${vectors.length}/${batch.length}`);
        out.push(...vectors);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return out;
}

/**
 * 读取 embedding key：环境变量优先，其次本地文件。
 * 不把 key 写进 Git 跟踪的任何文件。
 */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.DASHSCOPE_API_KEY || env.QCE_DASHSCOPE_KEY || '';
}
