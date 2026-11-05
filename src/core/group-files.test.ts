import { describe, it, expect } from 'vitest';
import { formatSize, filterFiles, summarizeFiles, renderFileTable, findFile, type FileEntry } from './group-files.js';

const files: FileEntry[] = [
  { size: 1024, name: '课件1.pdf', fid: 'f1' },
  { size: 5 * 1024 * 1024, name: '作业.docx', fid: 'f2' },
  { size: 3 * 1024 * 1024 * 1024, name: '素材包.zip', fid: 'f3' },
  { size: 800, name: 'README', fid: 'f4' },
];

describe('formatSize', () => {
  it('按量级选择单位', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('非法值不崩', () => {
    expect(formatSize(-1)).toBe('?');
    expect(formatSize(Number.NaN)).toBe('?');
  });
});

describe('filterFiles', () => {
  it('按关键词过滤，大小写不敏感', () => {
    expect(filterFiles(files, { keyword: '课件' }).map((f) => f.fid)).toEqual(['f1']);
    expect(filterFiles([{ size: 1, name: 'Report.PDF', fid: 'x' }], { keyword: 'report' })).toHaveLength(1);
  });

  it('按扩展名过滤（带不带点都行）', () => {
    expect(filterFiles(files, { ext: 'pdf' }).map((f) => f.fid)).toEqual(['f1']);
    expect(filterFiles(files, { ext: '.zip' }).map((f) => f.fid)).toEqual(['f3']);
  });

  it('按大小过滤', () => {
    expect(filterFiles(files, { minSize: 1024 * 1024 }).map((f) => f.fid)).toEqual(['f2', 'f3']);
    expect(filterFiles(files, { maxSize: 1024 }).map((f) => f.fid)).toEqual(['f1', 'f4']);
  });

  it('空条件返回全部', () => {
    expect(filterFiles(files)).toHaveLength(4);
  });
});

describe('summarizeFiles', () => {
  it('统计数量、总大小与按扩展名分布', () => {
    const s = summarizeFiles(files);
    expect(s.count).toBe(4);
    expect(s.totalSize).toBe(1024 + 5 * 1024 * 1024 + 3 * 1024 * 1024 * 1024 + 800);
    expect(s.byExt[0].ext).toBe('zip');
    expect(s.byExt.map((e) => e.ext)).toContain('(无扩展名)');
  });

  it('空列表', () => {
    expect(summarizeFiles([])).toEqual({ count: 0, totalSize: 0, byExt: [] });
  });
});

describe('renderFileTable', () => {
  it('空列表给出提示', () => {
    expect(renderFileTable([])).toContain('没有文件');
  });

  it('超出 limit 时显示省略提示', () => {
    const text = renderFileTable(files, 2);
    expect(text).toContain('还有 2 个未显示');
  });

  it('包含大小与文件名', () => {
    const text = renderFileTable(files.slice(0, 1));
    expect(text).toContain('1.0 KB');
    expect(text).toContain('课件1.pdf');
  });
});

describe('findFile', () => {
  it('精确文件名优先', () => {
    expect(findFile(files, '作业.docx')?.fid).toBe('f2');
  });

  it('按 fid 查找', () => {
    expect(findFile(files, 'f3')?.name).toBe('素材包.zip');
  });

  it('模糊匹配唯一时返回', () => {
    expect(findFile(files, '素材')?.fid).toBe('f3');
  });

  it('模糊匹配多个时返回 null（不瞎猜）', () => {
    const many = [
      { size: 1, name: 'a-1.txt', fid: '1' },
      { size: 1, name: 'a-2.txt', fid: '2' },
    ];
    expect(findFile(many, 'a-')).toBeNull();
  });

  it('找不到返回 null', () => {
    expect(findFile(files, '不存在')).toBeNull();
  });
});
