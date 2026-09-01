import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

interface StoredPrivateMemory {
  version: 1;
  updatedAt: string;
  summary: string;
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MEMORY_DIR = resolve(PROJECT_ROOT, 'private/memory');
const MAX_SUMMARY_CHARS = 3_000;

function memoryPath(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id');
  return resolve(MEMORY_DIR, `private-${userId}.json`);
}

function sharedMemoryPath(): string {
  return resolve(MEMORY_DIR, 'private-shared.json');
}

export class PrivateMemoryStore {
  constructor(private readonly userId: number) {}

  load(): StoredPrivateMemory {
    const path = memoryPath(this.userId);
    if (!existsSync(path)) return { version: 1, updatedAt: '', summary: '' };
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredPrivateMemory>;
      return {
        version: 1,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
        summary: typeof raw.summary === 'string' ? raw.summary.slice(0, MAX_SUMMARY_CHARS) : '',
      };
    } catch {
      return { version: 1, updatedAt: '', summary: '' };
    }
  }

  save(summary: string): StoredPrivateMemory {
    const record: StoredPrivateMemory = {
      version: 1,
      updatedAt: new Date().toISOString(),
      summary: summary.replace(/\0/g, '').trim().slice(0, MAX_SUMMARY_CHARS),
    };
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true, mode: 0o700 });
    const path = memoryPath(this.userId);
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 });
    renameSync(tempPath, path);
    try { chmodSync(path, 0o600); } catch {}
    return record;
  }
}

export class SharedPrivateMemoryStore {
  load(): StoredPrivateMemory {
    const path = sharedMemoryPath();
    if (!existsSync(path)) return { version: 1, updatedAt: '', summary: '' };
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredPrivateMemory>;
      return {
        version: 1,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
        summary: typeof raw.summary === 'string' ? raw.summary.slice(0, MAX_SUMMARY_CHARS) : '',
      };
    } catch {
      return { version: 1, updatedAt: '', summary: '' };
    }
  }

  save(summary: string): StoredPrivateMemory {
    const record: StoredPrivateMemory = {
      version: 1,
      updatedAt: new Date().toISOString(),
      summary: summary.replace(/\0/g, '').trim().slice(0, MAX_SUMMARY_CHARS),
    };
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true, mode: 0o700 });
    const path = sharedMemoryPath();
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 });
    renameSync(tempPath, path);
    try { chmodSync(path, 0o600); } catch {}
    return record;
  }
}
