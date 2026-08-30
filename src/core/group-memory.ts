import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

interface StoredGroupMemory {
  version: 1;
  updatedAt: string;
  summary: string;
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MEMORY_DIR = resolve(PROJECT_ROOT, 'private/memory');
const MAX_SUMMARY_CHARS = 3_000;

function memoryPath(groupId: number): string {
  if (!Number.isSafeInteger(groupId) || groupId <= 0) throw new Error('Invalid group id');
  return resolve(MEMORY_DIR, `group-${groupId}.json`);
}

export class GroupMemoryStore {
  constructor(private readonly groupId: number) {}

  load(): StoredGroupMemory {
    const path = memoryPath(this.groupId);
    if (!existsSync(path)) return { version: 1, updatedAt: '', summary: '' };
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredGroupMemory>;
      return {
        version: 1,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
        summary: typeof raw.summary === 'string' ? raw.summary.slice(0, MAX_SUMMARY_CHARS) : '',
      };
    } catch {
      return { version: 1, updatedAt: '', summary: '' };
    }
  }

  save(summary: string): StoredGroupMemory {
    const record: StoredGroupMemory = {
      version: 1,
      updatedAt: new Date().toISOString(),
      summary: summary.replace(/\0/g, '').trim().slice(0, MAX_SUMMARY_CHARS),
    };
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true, mode: 0o700 });
    const path = memoryPath(this.groupId);
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 });
    renameSync(tempPath, path);
    try { chmodSync(path, 0o600); } catch {}
    return record;
  }
}
