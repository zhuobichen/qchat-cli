import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildSendPlan, formatPlan, toRelativeBodyFile } from './push.js';

describe('buildSendPlan', () => {
  it('按 agently-cli 的 message +send 形态构造参数', () => {
    const plan = buildSendPlan({ to: 'a@b.com', subject: '群日报 123', bodyFile: 'output/d.md', bin: 'agently-cli' });
    expect(plan.bin).toBe('agently-cli');
    expect(plan.args).toEqual([
      'message', '+send',
      '--to', 'a@b.com',
      '--subject', '群日报 123',
      '--body-file', 'output/d.md',
    ]);
  });

  it('设置 QCE_AGENTLY_HOME 时注入 HOME/USERPROFILE', () => {
    const old = process.env.QCE_AGENTLY_HOME;
    process.env.QCE_AGENTLY_HOME = 'D:/tmp/ah';
    try {
      const plan = buildSendPlan({ to: 'a@b.com', subject: 's', bodyFile: 'f.md' });
      expect(plan.env).toEqual({ HOME: 'D:/tmp/ah', USERPROFILE: 'D:/tmp/ah' });
    } finally {
      if (old === undefined) delete process.env.QCE_AGENTLY_HOME;
      else process.env.QCE_AGENTLY_HOME = old;
    }
  });

  it('支持用环境变量覆盖可执行文件', () => {
    const old = process.env.AGENTLY_BIN;
    process.env.AGENTLY_BIN = '/opt/agently';
    try {
      expect(buildSendPlan({ to: 'a@b.com', subject: 's', bodyFile: 'f.md' }).bin).toBe('/opt/agently');
    } finally {
      if (old === undefined) delete process.env.AGENTLY_BIN;
      else process.env.AGENTLY_BIN = old;
    }
  });
});

describe('formatPlan', () => {
  it('含空格的参数加引号', () => {
    const text = formatPlan({ bin: 'agently-cli', args: ['--subject', '群日报 123'] });
    expect(text).toBe('agently-cli --subject "群日报 123"');
  });

  it('普通参数不加引号', () => {
    expect(formatPlan({ bin: 'x', args: ['--to', 'a@b.com'] })).toBe('x --to a@b.com');
  });
});

describe('toRelativeBodyFile', () => {
  it('转成相对路径并使用正斜杠（跨平台）', () => {
    const base = process.cwd();
    const abs = join(base, 'output', 'digest-1-2026-11-05.md');
    expect(toRelativeBodyFile(abs, base)).toBe('output/digest-1-2026-11-05.md');
  });

  it('已经是正斜杠的输入保持不变', () => {
    const base = process.cwd();
    expect(toRelativeBodyFile(`${base}/output/a.md`, base)).toBe('output/a.md');
  });
});
