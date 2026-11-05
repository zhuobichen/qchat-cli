import { describe, it, expect } from 'vitest';
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
  it('转成相对路径并使用正斜杠', () => {
    const base = process.cwd();
    const abs = `${base}\\output\\digest-1-2026-11-05.md`;
    expect(toRelativeBodyFile(abs, base)).toBe('output/digest-1-2026-11-05.md');
  });
});
