/**
 * 危险操作确认机制
 * 确保高危操作经过用户确认
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { auditLogger } from './audit.js';

export interface DangerousOperation {
  name: string;
  description: string;
  severity: 'high' | 'critical';
  confirmationRequired: boolean;
  undoable: boolean;
  warningMessage?: string;
}

export const DANGEROUS_OPERATIONS: Record<string, DangerousOperation> = {
  deleteFriend: {
    name: '删除好友',
    description: '永久删除指定好友',
    severity: 'critical',
    confirmationRequired: true,
    undoable: false,
    warningMessage: '⚠️ 危险操作：删除好友后无法恢复！',
  },
  leaveGroup: {
    name: '退出群聊',
    description: '退出指定群聊',
    severity: 'critical',
    confirmationRequired: true,
    undoable: false,
    warningMessage: '⚠️ 危险操作：退出后需要重新申请入群！',
  },
  kickGroupMember: {
    name: '踢出群成员',
    description: '将指定成员移出群聊',
    severity: 'critical',
    confirmationRequired: true,
    undoable: false,
    warningMessage: '⚠️ 危险操作：被踢出后需要重新申请入群！',
  },
  setGroupAddRequest: {
    name: '处理加群请求',
    description: '同意或拒绝入群申请',
    severity: 'high',
    confirmationRequired: true,
    undoable: true,
    warningMessage: '⚠️ 操作会影响入群申请结果',
  },
  muteAllGroup: {
    name: '全员禁言',
    description: '禁止群内所有成员发言',
    severity: 'high',
    confirmationRequired: true,
    undoable: true,
    warningMessage: '⚠️ 操作会影响所有群成员发言权限',
  },
  setGroupLeave: {
    name: '解散群聊',
    description: '解散指定群聊（仅群主）',
    severity: 'critical',
    confirmationRequired: true,
    undoable: false,
    warningMessage: '⚠️ 危险操作：解散后无法恢复！',
  },
};

export class DangerGuard {
  private bypassMode: boolean = false;

  /**
   * 启用 bypass 模式（用于自动化脚本）
   */
  enableBypass(): void {
    this.bypassMode = true;
    console.log(chalk.yellow('[安全] 已启用 bypass 模式，跳过所有确认'));
  }

  /**
   * 禁用 bypass 模式
   */
  disableBypass(): void {
    this.bypassMode = false;
  }

  /**
   * 是否为 bypass 模式
   */
  isBypass(): boolean {
    return this.bypassMode;
  }

  /**
   * 确认危险操作
   */
  async confirm(operationKey: string, target: string | number, force: boolean = false): Promise<boolean> {
    const operation = DANGEROUS_OPERATIONS[operationKey];
    
    if (!operation) {
      console.warn(chalk.yellow(`未知操作: ${operationKey}`));
      return true;
    }

    // Bypass 模式跳过确认
    if (this.bypassMode) {
      auditLogger.warn(operation.name, target, { operation: operationKey, bypass: true });
      return true;
    }

    // Force 参数跳过确认
    if (force) {
      auditLogger.warn(operation.name, target, { operation: operationKey, forced: true });
      return true;
    }

    // 显示警告信息
    console.log('');
    if (operation.warningMessage) {
      console.log(chalk.red(operation.warningMessage));
    }
    console.log(chalk.dim(`操作: ${operation.description}`));
    console.log(chalk.dim(`目标: ${target}`));
    console.log('');

    // 严重操作需要输入目标确认
    if (operation.severity === 'critical') {
      const { confirm, targetConfirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `确认执行「${operation.name}」？`,
          default: false,
        },
        {
          type: 'input',
          name: 'targetConfirm',
          message: `请再次输入目标 ID "${target}" 确认：`,
          when: (answers) => answers.confirm,
          validate: (input) => {
            return input === String(target) || input === target;
          },
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('操作已取消'));
        auditLogger.fail(operation.name, target, { reason: '用户取消' });
        return false;
      }
    } else {
      // 高危操作只需要简单确认
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `确认执行「${operation.name}」？`,
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('操作已取消'));
        auditLogger.fail(operation.name, target, { reason: '用户取消' });
        return false;
      }
    }

    auditLogger.success(operation.name, target, { operation: operationKey });
    return true;
  }

  /**
   * 检查操作是否为危险操作
   */
  isDangerous(operationKey: string): boolean {
    return operationKey in DANGEROUS_OPERATIONS;
  }

  /**
   * 获取操作信息
   */
  getOperation(operationKey: string): DangerousOperation | undefined {
    return DANGEROUS_OPERATIONS[operationKey];
  }

  /**
   * 获取所有危险操作列表
   */
  listOperations(): DangerousOperation[] {
    return Object.values(DANGEROUS_OPERATIONS);
  }
}

// 单例
export const dangerGuard = new DangerGuard();
