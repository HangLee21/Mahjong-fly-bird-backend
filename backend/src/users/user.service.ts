import { UserRepository } from './user.repository.js';

export class UserService {
  constructor(private readonly users = new UserRepository()) {}

  getUser(userId: string) {
    return this.users.findById(userId);
  }

  upsertWechatUser(input: { openid: string; unionid?: string; nickname?: string; avatarUrl?: string }) {
    return this.users.upsertByOpenid(input);
  }
}
