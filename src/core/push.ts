/**
 * 日报推送：把 Markdown 文件通过本机 agently-cli 发出去。
 *
 * 只负责构造命令参数（纯函数），真正执行留给命令层，便于单测。
 */

import path from 'node:path';

export interface SendTarget {
  to: string;
  subject: string;
  /** 相对当前工作目录的路径（agently-cli 要求） */
  bodyFile: string;
  bin?: string;
}

export interface SendPlan {
  bin: string;
  args: string[];
  /** 需要注入给子进程的环境变量（如把 HOME 指到可写目录） */
  env?: Record<string, string>;
}

export function buildSendPlan(target: SendTarget): SendPlan {
  const bin = target.bin || process.env.AGENTLY_BIN || 'agently-cli';
  const args = [
    'message', '+send',
    '--to', target.to,
    '--subject', target.subject,
    '--body-file', target.bodyFile,
  ];
  const env: Record<string, string> = {};
  const home = process.env.QCE_AGENTLY_HOME;
  if (home) {
    // agently-cli 把凭据写到 $HOME/.agently-cli；受限账户下需要指到可写目录
    env.HOME = home;
    env.USERPROFILE = home;
  }
  return { bin, args, ...(Object.keys(env).length ? { env } : {}) };
}

/** 供 --push-dry 打印用 */
export function formatPlan(plan: SendPlan): string {
  const quoted = plan.args.map((a) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a));
  return `${plan.bin} ${quoted.join(' ')}`;
}

/** 把绝对路径转成 agently-cli 需要的相对路径（统一正斜杠） */
export function toRelativeBodyFile(absPath: string, baseDir: string = process.cwd()): string {
  return path.relative(baseDir, absPath).split(path.sep).join('/');
}
