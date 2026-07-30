import { describe, expect, it, vi } from 'vitest';
import { WechatService, type WechatServiceConfig } from '../src/auth/wechat.service.js';
import { AppError } from '../src/common/errors.js';

const config: WechatServiceConfig = {
  appId: 'wx-test-wechat-app-id',
  appSecret: 'test-wechat-app-secret',
  mockLogin: false,
  timeoutMs: 100
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('WechatService', () => {
  it('exchanges a wx.login code for openid without exposing session_key', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://api.weixin.qq.com/sns/jscode2session');
      expect(url.searchParams.get('appid')).toBe(config.appId);
      expect(url.searchParams.get('secret')).toBe(config.appSecret);
      expect(url.searchParams.get('js_code')).toBe('temporary-code');
      return jsonResponse({
        openid: 'openid-1',
        unionid: 'unionid-1',
        session_key: 'must-not-leave-service'
      });
    });

    const session = await new WechatService(fetcher as typeof fetch, config).codeToSession('temporary-code');
    expect(session).toEqual({ openid: 'openid-1', unionid: 'unionid-1' });
  });

  it.each([40029, 40163])('returns a sanitized 401 for invalid code error %s', async (errcode) => {
    const fetcher = vi.fn(async () => jsonResponse({ errcode, errmsg: `provider response ${config.appSecret}` }));

    try {
      await new WechatService(fetcher as typeof fetch, config).codeToSession('invalid-code');
      throw new Error('Expected login to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('UNAUTHORIZED');
      expect((error as AppError).statusCode).toBe(401);
      expect((error as Error).message).not.toContain(config.appSecret);
      expect((error as Error).message).not.toContain('api.weixin.qq.com');
    }
  });

  it('sanitizes AppID and AppSecret configuration errors', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ errcode: 40125, errmsg: config.appSecret }));

    await expect(new WechatService(fetcher as typeof fetch, config).codeToSession('code')).rejects.toMatchObject({
      code: 'WECHAT_SERVICE_ERROR',
      statusCode: 502,
      message: 'WeChat login service configuration is invalid.'
    });
  });

  it('handles non-JSON upstream responses without returning their content', async () => {
    const fetcher = vi.fn(async () => new Response('<html>upstream failure</html>', { status: 200 }));

    await expect(new WechatService(fetcher as typeof fetch, config).codeToSession('code')).rejects.toMatchObject({
      code: 'WECHAT_SERVICE_ERROR',
      statusCode: 502,
      message: 'WeChat login service returned an invalid response.'
    });
  });

  it('handles upstream network failures without exposing the request URL', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error(`request failed for https://api.weixin.qq.com/?secret=${config.appSecret}`);
    });

    try {
      await new WechatService(fetcher as typeof fetch, config).codeToSession('code');
      throw new Error('Expected login to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'WECHAT_SERVICE_ERROR',
        statusCode: 502,
        message: 'WeChat login service is temporarily unavailable.'
      });
      expect((error as Error).message).not.toContain(config.appSecret);
      expect((error as Error).message).not.toContain('api.weixin.qq.com');
    }
  });

  it('returns a sanitized timeout error', async () => {
    const timeoutConfig = { ...config, timeoutMs: 5 };
    const fetcher = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );

    await expect(new WechatService(fetcher as typeof fetch, timeoutConfig).codeToSession('code')).rejects.toMatchObject({
      code: 'WECHAT_SERVICE_TIMEOUT',
      statusCode: 504,
      message: 'WeChat login service timed out.'
    });
  });
});
