/**
 * 统一错误处理系统
 * 提供标准化的错误类型和错误码
 */

export enum ErrorCode {
  // 认证相关
  AUTH_NOT_CONFIGURED = 'AUTH_NOT_CONFIGURED',
  AUTH_INVALID_TOKEN = 'AUTH_INVALID_TOKEN',
  AUTH_CONNECTION_FAILED = 'AUTH_CONNECTION_FAILED',

  // 网络相关
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  REQUEST_FAILED = 'REQUEST_FAILED',

  // 消息相关
  MESSAGE_NOT_FOUND = 'MESSAGE_NOT_FOUND',
  MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED',
  MESSAGE_FETCH_FAILED = 'MESSAGE_FETCH_FAILED',

  // 会话相关
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_INVALID = 'SESSION_INVALID',

  // 权限相关
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  SAFETY_BLOCKED = 'SAFETY_BLOCKED',

  // 操作相关
  OPERATION_FAILED = 'OPERATION_FAILED',
  OPERATION_CANCELLED = 'OPERATION_CANCELLED',

  // 文件相关
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_WRITE_FAILED = 'FILE_WRITE_FAILED',
  FILE_READ_FAILED = 'FILE_READ_FAILED',

  // 通用
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

export class QChatError extends Error {
  public readonly code: ErrorCode;
  public readonly status?: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode,
    options?: {
      status?: number;
      details?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'QChatError';
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      details: this.details,
      stack: this.stack,
    };
  }

  static fromError(error: unknown, defaultCode: ErrorCode = ErrorCode.UNKNOWN_ERROR): QChatError {
    if (error instanceof QChatError) {
      return error;
    }

    if (error instanceof Error) {
      return new QChatError(error.message, defaultCode, { cause: error });
    }

    return new QChatError(
      String(error),
      defaultCode,
      { details: { original: error } }
    );
  }
}

export class ValidationError extends QChatError {
  constructor(message: string, field?: string) {
    super(message, ErrorCode.VALIDATION_ERROR, {
      details: { field },
    });
    this.name = 'ValidationError';
  }
}

export class NetworkError extends QChatError {
  constructor(message: string, status?: number, cause?: Error) {
    super(message, ErrorCode.NETWORK_ERROR, { status, cause });
    this.name = 'NetworkError';
  }

  static timeout(url: string): NetworkError {
    return new NetworkError(
      `请求超时: ${url}`,
      408
    );
  }

  static connectionFailed(url: string, cause?: Error): NetworkError {
    return new NetworkError(
      `连接失败: ${url}`,
      undefined,
      cause
    );
  }
}

export class AuthError extends QChatError {
  constructor(message: string, code: ErrorCode = ErrorCode.AUTH_INVALID_TOKEN) {
    super(message, code);
    this.name = 'AuthError';
  }

  static notConfigured(): AuthError {
    return new AuthError(
      '认证未配置，请先运行 qce login',
      ErrorCode.AUTH_NOT_CONFIGURED
    );
  }

  static invalidToken(): AuthError {
    return new AuthError(
      '认证令牌无效',
      ErrorCode.AUTH_INVALID_TOKEN
    );
  }
}

export class SafetyError extends QChatError {
  constructor(message: string) {
    super(message, ErrorCode.SAFETY_BLOCKED);
    this.name = 'SafetyError';
  }

  static sessionNotAllowed(sessionId: number): SafetyError {
    return new SafetyError(
      `会话 ${sessionId} 未在白名单中或发送功能未启用`
    );
  }
}
