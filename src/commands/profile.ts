import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseHistoryFile } from '../core/historyfile.js';
import { buildProfiles, renderProfiles, type MemberProfile } from '../core/member-profile.js';
import { generateProfiles, profilesToMemories } from '../core/profile-store.js';

export function profileCommand(program: Command): void {
  program
    .command('profile <group>')
    .description('从历史聊天统计群成员画像（谁是谁、爱说什么、常和谁聊）')
    .option('-f, --file <path>', '历史文件路径')
    .option('-n, --top <n>', '展示前 N 个人', '8')
    .option('--save', '把画像存到 private/profiles/')
    .option('--memory', '同时写进长期记忆（配合 --save）')
    .option('--json', '输出 JSON')
    .action((group, options) => {
      const file = options.file ?? join('output', `group-${group}-full.txt`);
      if (!existsSync(file)) {
        console.log(chalk.red(`找不到历史文件：${file}`));
        return;
      }
      const parsed = parseHistoryFile(readFileSync(file, 'utf8'));
      const profiles = buildProfiles(parsed.records);
      const shown = profiles.slice(0, Number(options.top) || 8);

      if (options.json) {
        console.log(JSON.stringify(shown, null, 2));
        return;
      }
      console.log(chalk.cyan(`${file}：${parsed.records.length} 条消息，${profiles.length} 人`));
      console.log();
      console.log(renderProfiles(shown));

      if (options.save) {
        generateProfiles(group, file);
        console.log(chalk.green(`已保存画像：private/profiles/${group}.json`));
        if (options.memory) {
          const added = profilesToMemories(group, profiles);
          console.log(chalk.green(`已写入长期记忆：+${added} 条（scope=g${group}）`));
        }
      }
    });
}
