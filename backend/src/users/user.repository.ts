import { prisma } from '../storage/prisma.js';

export class UserRepository {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  upsertByOpenid(input: { openid: string; unionid?: string; nickname?: string; avatarUrl?: string }) {
    return prisma.user.upsert({
      where: { openid: input.openid },
      update: {
        unionid: input.unionid,
        nickname: input.nickname,
        avatarUrl: input.avatarUrl
      },
      create: {
        openid: input.openid,
        unionid: input.unionid,
        nickname: input.nickname,
        avatarUrl: input.avatarUrl
      }
    });
  }
}
