/**
 * 管理命令
 * 处理危险操作的 CLI 命令
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { auditLogger, type AuditLogEntry } from '../core/audit.js';
import { dangerGuard } from '../core/danger.js';
import { resolveSession } from '../utils/resolveSession.js';

export function adminCommand(program: Command): void {
  const admin = program
    .command('admin')
    .description('管理命令（危险操作需要确认）');

  // 审计日志查看
  admin
    .command('audit [count]')
    .description('查看审计日志')
    .option('--clear', '清空日志')
    .action(async (count, options) => {
      if (options.clear) {
        auditLogger.clear();
        console.log(chalk.green('审计日志已清空'));
        return;
      }

      const logs = auditLogger.readFromFile(parseInt(count) || 50);
      
      if (logs.length === 0) {
        console.log(chalk.yellow('暂无审计日志'));
        return;
      }

      console.log(chalk.bold('\n📋 审计日志\n'));
      console.log(chalk.dim('─'.repeat(80)));

      logs.forEach((log: AuditLogEntry) => {
        const time = new Date(log.timestamp).toLocaleString('zh-CN');
        const status = log.success ? chalk.green('✓') : chalk.red('✗');
        const action = chalk.cyan(log.action);
        const target = chalk.yellow(String(log.target));
        
        console.log(`${chalk.dim(time)} ${status} ${action} → ${target}`);
        
        if (log.details?._warning) {
          console.log(chalk.dim('  └─') + chalk.yellow(' ⚠️ 危险操作'));
        }
      });

      console.log(chalk.dim('─'.repeat(80)));
      console.log(chalk.dim(`共 ${logs.length} 条记录\n`));
    });

  // 删除好友
  admin
    .command('delete-friend <userId>')
    .description('删除好友（危险操作）')
    .option('-f, --force', '跳过确认')
    .action(async (userId, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const id = parseInt(userId);

      // 确认操作
      const confirmed = await dangerGuard.confirm('deleteFriend', id, options.force);
      if (!confirmed) return;

      try {
        await client.deleteFriend(id);
        console.log(chalk.green(`✓ 已删除好友 ${id}`));
        auditLogger.success('删除好友', id);
      } catch (error) {
        console.log(chalk.red(`✗ 删除失败: ${error}`));
        auditLogger.fail('删除好友', id, { error: String(error) });
      }
    });

  // 退出群聊
  admin
    .command('leave-group <groupId>')
    .description('退出群聊（危险操作）')
    .option('-f, --force', '跳过确认')
    .option('--dismiss', '解散群聊（仅群主）')
    .action(async (groupId, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const id = parseInt(groupId);

      // 确认操作
      const operationKey = options.dismiss ? 'setGroupLeave' : 'leaveGroup';
      const confirmed = await dangerGuard.confirm(operationKey, id, options.force);
      if (!confirmed) return;

      try {
        await client.leaveGroup(id, options.dismiss);
        console.log(chalk.green(`✓ 已${options.dismiss ? '解散' : '退出'}群聊 ${id}`));
        auditLogger.success(options.dismiss ? '解散群聊' : '退出群聊', id);
      } catch (error) {
        console.log(chalk.red(`✗ 操作失败: ${error}`));
        auditLogger.fail(options.dismiss ? '解散群聊' : '退出群聊', id, { error: String(error) });
      }
    });

  // 踢出群成员
  admin
    .command('kick <groupId> <userId>')
    .description('踢出群成员（危险操作）')
    .option('-f, --force', '跳过确认')
    .option('--reject', '拒绝再次入群申请')
    .action(async (groupId, userId, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const gId = parseInt(groupId);
      const uId = parseInt(userId);

      // 确认操作
      const confirmed = await dangerGuard.confirm('kickGroupMember', `${gId}/${uId}`, options.force);
      if (!confirmed) return;

      try {
        await client.kickGroupMember(gId, uId, options.reject);
        console.log(chalk.green(`✓ 已踢出 ${uId} 从群 ${gId}`));
        auditLogger.success('踢出群成员', `${gId}/${uId}`);
      } catch (error) {
        console.log(chalk.red(`✗ 操作失败: ${error}`));
        auditLogger.fail('踢出群成员', `${gId}/${uId}`, { error: String(error) });
      }
    });

  // 全员禁言
  admin
    .command('mute-all <groupId>')
    .description('开启/关闭全员禁言')
    .option('-f, --force', '跳过确认')
    .action(async (groupId, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const id = parseInt(groupId);

      // 确认操作
      const confirmed = await dangerGuard.confirm('muteAllGroup', id, options.force);
      if (!confirmed) return;

      try {
        await client.muteAllGroup(id, true);
        console.log(chalk.green(`✓ 已开启全员禁言 ${id}`));
        auditLogger.success('全员禁言', id);
      } catch (error) {
        console.log(chalk.red(`✗ 操作失败: ${error}`));
        auditLogger.fail('全员禁言', id, { error: String(error) });
      }
    });

  // 解禁言
  admin
    .command('unmute-all <groupId>')
    .description('关闭全员禁言')
    .action(async (groupId) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const id = parseInt(groupId);

      try {
        await client.muteAllGroup(id, false);
        console.log(chalk.green(`✓ 已关闭全员禁言 ${id}`));
        auditLogger.success('关闭全员禁言', id);
      } catch (error) {
        console.log(chalk.red(`✗ 操作失败: ${error}`));
        auditLogger.fail('关闭全员禁言', id, { error: String(error) });
      }
    });

  // 禁言成员
  admin
    .command('mute <groupId> <userId> [duration]')
    .description('禁言群成员（默认30分钟）')
    .option('-f, --force', '跳过确认')
    .action(async (groupId, userId, duration, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const gId = parseInt(groupId);
      const uId = parseInt(userId);
      const dur = parseInt(duration) || 1800; // 默认30分钟

      if (dur === 0) {
        // 解禁言
        try {
          await client.muteGroupMember(gId, uId, 0);
          console.log(chalk.green(`✓ 已解除 ${uId} 的禁言`));
          auditLogger.success('解除禁言', `${gId}/${uId}`);
        } catch (error) {
          console.log(chalk.red(`✗ 操作失败: ${error}`));
        }
        return;
      }

      // 确认操作（禁言超过1小时需要确认）
      if (dur > 3600) {
        const confirmed = await dangerGuard.confirm('muteGroupMember', `${gId}/${uId}`, options.force);
        if (!confirmed) return;
      }

      try {
        await client.muteGroupMember(gId, uId, dur);
        const minutes = Math.floor(dur / 60);
        console.log(chalk.green(`✓ 已禁言 ${uId} ${minutes} 分钟`));
        auditLogger.success('禁言成员', `${gId}/${uId}`, { duration: dur });
      } catch (error) {
        console.log(chalk.red(`✗ 操作失败: ${error}`));
        auditLogger.fail('禁言成员', `${gId}/${uId}`, { error: String(error) });
      }
    });

  // 设置群管理员
  admin
    .command('admin-set <groupId> <userId>')
    .description('设置/取消群管理员')
    .option('-f, --force', '跳过确认')
    .action(async (groupId, userId, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const gId = parseInt(groupId);
      const uId = parseInt(userId);

      // 确认操作
      const confirmed = await dangerGuard.confirm('setGroupAdmin', `${gId}/${uId}`, options.force);
      if (!confirmed) return;

      try {
        await client.setGroupAdmin(gId, uId, true);
        console.log(chalk.green(`✓ 已设置 ${uId} 为群管理员`));
        auditLogger.success('设置群管理员', `${gId}/${uId}`);
      } catch (error) {
        console.log(chalk.red(`✗ 操作失败: ${error}`));
        auditLogger.fail('设置群管理员', `${gId}/${uId}`, { error: String(error) });
      }
    });

  // 取消群管理员
  admin
    .command('admin-remove <groupId> <userId>')
    .description('取消群管理员')
    .option('-f, --force', '跳过确认')
    .action(async (groupId, userId, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const gId = parseInt(groupId);
      const uId = parseInt(userId);

      try {
        await client.setGroupAdmin(gId, uId, false);
        console.log(chalk.green(`✓ 已取消 ${uId} 的管理员权限`));
        auditLogger.success('取消群管理员', `${gId}/${uId}`);
      } catch (error) {
        console.log(chalk.red(`✗ 操作失败: ${error}`));
        auditLogger.fail('取消群管理员', `${gId}/${uId}`, { error: String(error) });
      }
    });

  // 安全模式设置
  const safety = admin
    .command('safety')
    .description('安全设置');

  safety
    .command('bypass')
    .description('启用 bypass 模式（跳过所有确认，用于脚本）')
    .action(() => {
      dangerGuard.enableBypass();
      console.log(chalk.yellow('已启用 bypass 模式'));
      console.log(chalk.dim('注意：所有危险操作将直接执行，不再确认！'));
    });

  safety
    .command('no-bypass')
    .description('禁用 bypass 模式')
    .action(() => {
      dangerGuard.disableBypass();
      console.log(chalk.green('已禁用 bypass 模式'));
    });

  safety
    .command('status')
    .description('查看安全状态')
    .action(() => {
      console.log(chalk.bold('\n🔒 安全状态\n'));
      console.log(`  Bypass 模式: ${dangerGuard.isBypass() ? chalk.red('已启用') : chalk.green('未启用')}`);
      console.log(`  审计日志: ${chalk.green('已启用')}`);
      console.log(`  危险操作数: ${dangerGuard.listOperations().length}`);
      console.log('');
    });

  // 查看危险操作列表
  admin
    .command('dangerous-list')
    .description('查看所有危险操作')
    .action(() => {
      const operations = dangerGuard.listOperations();
      
      console.log(chalk.bold('\n⚠️ 危险操作列表\n'));
      
      operations.forEach((op, index) => {
        const severity = op.severity === 'critical' ? chalk.red('🔴 极高') : chalk.yellow('🟠 高');
        console.log(`${index + 1}. ${chalk.cyan(op.name)} ${severity}`);
        console.log(chalk.dim(`   ${op.description}`));
        console.log(chalk.dim(`   可撤销: ${op.undoable ? chalk.green('是') : chalk.red('否')}`));
        console.log('');
      });
    });
}
