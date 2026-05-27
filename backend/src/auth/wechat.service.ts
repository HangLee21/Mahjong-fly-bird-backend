import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';

export interface WechatSession {
  openid: string;
  unionid?: string;
}

export class WechatService {
  async codeToSession(code: string): Promise<WechatSession> {
    if (env.WECHAT_MOCK_LOGIN) {
      return { openid: `mock_${code}` };
    }

    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', env.WECHAT_APP_ID);
    url.searchParams.set('secret', env.WECHAT_APP_SECRET);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    const response = await fetch(url);
    const data = (await response.json()) as { openid?: string; unionid?: string; errmsg?: string };
    if (!data.openid) throw new AppError('UNAUTHORIZED', data.errmsg ?? 'Wechat login failed.', 401);
    return { openid: data.openid, unionid: data.unionid };
  }
}
