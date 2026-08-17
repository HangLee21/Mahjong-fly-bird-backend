import { signAuthToken } from './jwt.js';
import { WechatService } from './wechat.service.js';
import { UserService } from '../users/user.service.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../common/logger.js';

export class AuthService {
  constructor(
    private readonly wechat = new WechatService(),
    private readonly users = new UserService()
  ) {}

  async wechatLogin(input: { code: string; nickname?: string; avatarUrl?: string }) {
    const session = await this.wechat.codeToSession(input.code);
    const avatarUrl = await this.proxyAvatar(input.avatarUrl, session.openid);
    const user = await this.users.upsertWechatUser({
      openid: session.openid,
      unionid: session.unionid,
      nickname: input.nickname,
      avatarUrl
    });
    return {
      token: signAuthToken({ userId: user.id, openid: user.openid }),
      user
    };
  }

  private async proxyAvatar(avatarUrl: string | undefined, key: string): Promise<string | undefined> {
    if (!avatarUrl || !/^https:\/\//i.test(avatarUrl)) return avatarUrl;
    if (avatarUrl.includes('assets.flybirdmahjong.fun')) return avatarUrl;

    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    const directory = '/app/game-assets/avatars';
    const filePath = join(directory, `${safeKey}.jpg`);
    try {
      const response = await fetch(avatarUrl, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return avatarUrl;
      const bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(directory, { recursive: true });
      await writeFile(filePath, bytes);
      return `${env.AVATAR_BASE_URL.replace(/\/+$/, '')}/${safeKey}.jpg`;
    } catch (error) {
      logger.warn({ error, avatarUrl }, 'Failed to proxy WeChat avatar');
      return avatarUrl;
    }
  }
}
