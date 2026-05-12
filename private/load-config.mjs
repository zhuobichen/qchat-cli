/**
 * 加载隐私配置（不提交到 git）
 * 复制 config.example.json 为 config.json 并填入你的 QQ 号
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'config.json');

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error('缺少 private/config.json，请复制 config.example.json 并填入你的配置');
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

export function getMyQQ() {
  const c = loadConfig();
  if (!c.myQQ) { console.error('请在 config.json 中设置 myQQ'); process.exit(1); }
  return c.myQQ;
}
