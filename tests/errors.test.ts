/**
 * 错误处理系统单元测试
 */

import { describe, it, expect } from '@jest/globals';
import {
  QChatError,
  ValidationError,
  NetworkError,
  AuthError,
  SafetyError,
  ErrorCode,
} from '../src/utils/errors.js';

describe('错误处理系统', () => {
  describe('QChatError', () => {
    it('应该正确创建错误对象', () => {
      const error = new QChatError('Test error', ErrorCode.UNKNOWN_ERROR);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(error.name).toBe('QChatError');
    });

    it('应该包含堆栈跟踪', () => {
      const error = new QChatError('Test error', ErrorCode.UNKNOWN_ERROR);
      expect(error.stack).toBeDefined();
    });

    it('应该支持可选的 status 和 details', () => {
      const error = new QChatError('Test error', ErrorCode.NETWORK_ERROR, {
        status: 500,
        details: { key: 'value' },
      });
      expect(error.status).toBe(500);
      expect(error.details).toEqual({ key: 'value' });
    });

    it('应该支持 cause 链', () => {
      const cause = new Error('Original error');
      const error = new QChatError('Wrapped error', ErrorCode.UNKNOWN_ERROR, { cause });
      expect(error.cause).toBe(cause);
    });

    it('应该正确序列化为 JSON', () => {
      const error = new QChatError('Test error', ErrorCode.UNKNOWN_ERROR, {
        status: 400,
      });
      const json = error.toJSON();
      expect(json.name).toBe('QChatError');
      expect(json.message).toBe('Test error');
      expect(json.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(json.status).toBe(400);
    });

    it('应该从普通 Error 转换', () => {
      const original = new Error('Original error');
      const qchatError = QChatError.fromError(original, ErrorCode.REQUEST_FAILED);
      expect(qchatError).toBeInstanceOf(QChatError);
      expect(qchatError.code).toBe(ErrorCode.REQUEST_FAILED);
      expect(qchatError.message).toBe('Original error');
    });

    it('应该保留 QChatError 不转换', () => {
      const original = new QChatError('Original', ErrorCode.NETWORK_ERROR);
      const converted = QChatError.fromError(original);
      expect(converted).toBe(original);
    });
  });

  describe('ValidationError', () => {
    it('应该创建验证错误', () => {
      const error = new ValidationError('Invalid input', 'email');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.name).toBe('ValidationError');
      expect(error.details?.field).toBe('email');
    });
  });

  describe('NetworkError', () => {
    it('应该创建网络超时错误', () => {
      const error = NetworkError.timeout('http://example.com');
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.name).toBe('NetworkError');
      expect(error.status).toBe(408);
      expect(error.message).toContain('超时');
    });

    it('应该创建连接失败错误', () => {
      const error = NetworkError.connectionFailed('http://example.com');
      expect(error.message).toContain('连接失败');
    });
  });

  describe('AuthError', () => {
    it('应该创建认证未配置错误', () => {
      const error = AuthError.notConfigured();
      expect(error.code).toBe(ErrorCode.AUTH_NOT_CONFIGURED);
      expect(error.message).toContain('未配置');
    });

    it('应该创建认证令牌无效错误', () => {
      const error = AuthError.invalidToken();
      expect(error.code).toBe(ErrorCode.AUTH_INVALID_TOKEN);
    });
  });

  describe('SafetyError', () => {
    it('应该创建会话未允许错误', () => {
      const error = SafetyError.sessionNotAllowed(123456);
      expect(error.code).toBe(ErrorCode.SAFETY_BLOCKED);
      expect(error.message).toContain('123456');
    });
  });

  describe('ErrorCode 枚举', () => {
    it('应该包含所有预期的错误码', () => {
      expect(ErrorCode.AUTH_NOT_CONFIGURED).toBe('AUTH_NOT_CONFIGURED');
      expect(ErrorCode.NETWORK_TIMEOUT).toBe('NETWORK_TIMEOUT');
      expect(ErrorCode.MESSAGE_NOT_FOUND).toBe('MESSAGE_NOT_FOUND');
      expect(ErrorCode.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
    });
  });
});
