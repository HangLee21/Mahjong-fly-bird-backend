import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';

export interface WechatSession {
  openid: string;
  unionid?: string;
}

export interface WechatServiceConfig {
  appId: string;
  appSecret: string;
  mockLogin: boolean;
  timeoutMs: number;
}

type WechatApiPayload = {
  openid?: unknown;
  unionid?: unknown;
  errcode?: unknown;
};

const defaultConfig: WechatServiceConfig = {
  appId: env.WECHAT_APP_ID,
  appSecret: env.WECHAT_APP_SECRET,
  mockLogin: env.WECHAT_MOCK_LOGIN,
  timeoutMs: env.WECHAT_API_TIMEOUT_MS
};

export class WechatService {
  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly config: WechatServiceConfig = defaultConfig
  ) {}

  async codeToSession(code: string): Promise<WechatSession> {
    if (this.config.mockLogin) {
      return { openid: `mock_${code}` };
    }

    this.assertConfigured();
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', this.config.appId);
    url.searchParams.set('secret', this.config.appSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let responseText: string;
    try {
      const response = await this.fetcher(url, { method: 'GET', signal: controller.signal });
      if (!response.ok) {
        throw new AppError('WECHAT_SERVICE_ERROR', 'WeChat login service is temporarily unavailable.', 502);
      }
      responseText = await response.text();
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted) {
        throw new AppError('WECHAT_SERVICE_TIMEOUT', 'WeChat login service timed out.', 504);
      }
      throw new AppError('WECHAT_SERVICE_ERROR', 'WeChat login service is temporarily unavailable.', 502);
    } finally {
      clearTimeout(timeout);
    }

    let data: WechatApiPayload;
    try {
      const parsed: unknown = JSON.parse(responseText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid payload');
      data = parsed as WechatApiPayload;
    } catch {
      throw new AppError('WECHAT_SERVICE_ERROR', 'WeChat login service returned an invalid response.', 502);
    }

    const errcode = typeof data.errcode === 'number' ? data.errcode : undefined;
    if (errcode !== undefined && errcode !== 0) this.throwWechatError(errcode);
    if (typeof data.openid !== 'string' || data.openid.length === 0) {
      throw new AppError('WECHAT_SERVICE_ERROR', 'WeChat login service returned an invalid response.', 502);
    }

    return {
      openid: data.openid,
      ...(typeof data.unionid === 'string' && data.unionid.length > 0 ? { unionid: data.unionid } : {})
    };
  }

  private assertConfigured() {
    const appId = this.config.appId.trim();
    const appSecret = this.config.appSecret.trim();
    if (
      !appId.startsWith('wx') ||
      appId.includes('replace') ||
      !appSecret ||
      appSecret.includes('replace') ||
      appSecret.includes('CHANGE_TO_')
    ) {
      throw new AppError('WECHAT_SERVICE_ERROR', 'WeChat login service is not configured.', 503);
    }
  }

  private throwWechatError(errcode: number): never {
    if (errcode === 40029 || errcode === 40163) {
      throw new AppError('UNAUTHORIZED', 'WeChat login code is invalid or expired.', 401);
    }
    if (errcode === 40013 || errcode === 40125) {
      throw new AppError('WECHAT_SERVICE_ERROR', 'WeChat login service configuration is invalid.', 502);
    }
    if (errcode === 45011) {
      throw new AppError('WECHAT_SERVICE_ERROR', 'Too many WeChat login requests. Please try again later.', 429);
    }
    throw new AppError('WECHAT_SERVICE_ERROR', 'WeChat login failed. Please try again.', 502);
  }
}
