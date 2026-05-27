export interface UserModel {
  id: string;
  openid: string;
  unionid?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
}
