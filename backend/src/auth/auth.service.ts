import { signAuthToken } from './jwt.js';
import { WechatService } from './wechat.service.js';
import { UserService } from '../users/user.service.js';

export class AuthService {
  constructor(
    private readonly wechat = new WechatService(),
    private readonly users = new UserService()
  ) {}

  async wechatLogin(input: { code: string; nickname?: string; avatarUrl?: string }) {
    const session = await this.wechat.codeToSession(input.code);
    const user = await this.users.upsertWechatUser({
      openid: session.openid,
      unionid: session.unionid,
      nickname: input.nickname,
      avatarUrl: input.avatarUrl
    });
    return {
      token: signAuthToken({ userId: user.id, openid: user.openid }),
      user
    };
  }
}
