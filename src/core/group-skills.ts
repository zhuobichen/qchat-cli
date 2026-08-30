import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, isAbsolute, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MAX_SKILLS = 2;
const MAX_SKILL_CHARS = 3_000;
const MAX_TOTAL_CHARS = 5_000;

interface SkillIndex { name: string; description: string; path: string; }

function skillRootPath(directory: string): string | null {
  const skillRoot = resolve(PROJECT_ROOT, directory || 'private/skills');
  const allowedRoot = resolve(PROJECT_ROOT, 'private/skills');
  const rootRelative = relative(allowedRoot, skillRoot);
  return isAbsolute(rootRelative) || rootRelative.startsWith('..') ? null : skillRoot;
}

export function loadRelevantSkills(directory: string, query: string): string {
  const skillRoot = skillRootPath(directory);
  if (!skillRoot || !existsSync(skillRoot)) return '';

  const index: SkillIndex[] = [];
  for (const entry of readdirSync(skillRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = resolve(skillRoot, entry.name, 'SKILL.md');
    if (!existsSync(skillPath) || !statSync(skillPath).isFile()) continue;
    const source = readFileSync(skillPath, 'utf8');
    const heading = source.match(/^#\s+(.+)$/m)?.[1]?.trim() || entry.name;
    const description = source.match(/description\s*:\s*(.+)/i)?.[1]?.trim() || source.slice(0, 240).replace(/\s+/g, ' ');
    index.push({ name: heading.slice(0, 80), description: description.slice(0, 240), path: skillPath });
  }

  const normalizedQuery = query.toLowerCase();
  const terms = normalizedQuery.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1);
  const hanText = normalizedQuery.match(/\p{Script=Han}/gu)?.join('') || '';
  for (let i = 0; i < hanText.length - 1; i += 1) terms.push(hanText.slice(i, i + 2));
  const selected = index
    .map((skill) => ({ skill, score: terms.reduce((score, term) => score + ((skill.name + ' ' + skill.description).toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, MAX_SKILLS);

  let remaining = MAX_TOTAL_CHARS;
  return selected.map(({ skill }) => {
    if (remaining <= 0) return '';
    const content = readFileSync(skill.path, 'utf8').replace(/\0/g, '').slice(0, Math.min(MAX_SKILL_CHARS, remaining));
    remaining -= content.length;
    return `Skill: ${basename(resolve(skill.path, '..'))}\n${content}`;
  }).filter(Boolean).join('\n---\n');
}

export function loadSkillByName(directory: string, name: string): string {
  const skillRoot = skillRootPath(directory);
  if (!skillRoot || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name) || !existsSync(skillRoot)) return '';
  const skillPath = resolve(skillRoot, name, 'SKILL.md');
  const relativePath = relative(skillRoot, skillPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath) || !existsSync(skillPath) || !statSync(skillPath).isFile()) return '';
  return readFileSync(skillPath, 'utf8').replace(/\0/g, '').slice(0, MAX_TOTAL_CHARS);
}
