/**
 * Rate Limiting 工具
 * 防止 API 请求过快
 */

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitInfo {
  count: number;
  resetTime: number;
  remaining: number;
}

export class RateLimiter {
  private requests: Map<string, { count: number; resetTime: number }> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = { maxRequests: 100, windowMs: 60000 }) {
    this.config = config;
  }

  setConfig(config: RateLimitConfig): void {
    this.config = config;
  }

  check(identifier: string): RateLimitInfo {
    const now = Date.now();
    let record = this.requests.get(identifier);

    if (!record || now >= record.resetTime) {
      record = {
        count: 0,
        resetTime: now + this.config.windowMs,
      };
      this.requests.set(identifier, record);
    }

    const info: RateLimitInfo = {
      count: record.count,
      resetTime: record.resetTime,
      remaining: Math.max(0, this.config.maxRequests - record.count),
    };

    return info;
  }

  tryAcquire(identifier: string): boolean {
    const info = this.check(identifier);

    if (info.remaining <= 0) {
      return false;
    }

    const record = this.requests.get(identifier);
    if (record) {
      record.count++;
    }

    return true;
  }

  waitForReset(identifier: string): Promise<void> {
    return new Promise((resolve) => {
      const info = this.check(identifier);
      const waitTime = info.resetTime - Date.now();

      if (waitTime <= 0) {
        resolve();
        return;
      }

      setTimeout(resolve, waitTime);
    });
  }

  async acquireOrWait(identifier: string): Promise<boolean> {
    if (this.tryAcquire(identifier)) {
      return true;
    }

    await this.waitForReset(identifier);
    return this.tryAcquire(identifier);
  }

  clear(identifier?: string): void {
    if (identifier) {
      this.requests.delete(identifier);
    } else {
      this.requests.clear();
    }
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now >= record.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}

export class UserRateLimiter extends RateLimiter {
  private static instance: UserRateLimiter;

  static getInstance(): UserRateLimiter {
    if (!UserRateLimiter.instance) {
      UserRateLimiter.instance = new UserRateLimiter({
        maxRequests: 60,
        windowMs: 60000,
      });
    }
    return UserRateLimiter.instance;
  }

  checkUser(userId: number | string): RateLimitInfo {
    return this.check(`user_${userId}`);
  }

  tryAcquireForUser(userId: number | string): boolean {
    return this.tryAcquire(`user_${userId}`);
  }
}

export class APIRateLimiter extends RateLimiter {
  private static instance: APIRateLimiter;

  static getInstance(): APIRateLimiter {
    if (!APIRateLimiter.instance) {
      APIRateLimiter.instance = new APIRateLimiter({
        maxRequests: 100,
        windowMs: 60000,
      });
    }
    return APIRateLimiter.instance;
  }
}
