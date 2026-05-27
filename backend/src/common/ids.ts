import { randomBytes, randomUUID } from 'node:crypto';

export const createId = (prefix: string) => `${prefix}_${randomUUID()}`;
export const createRoomCode = () => randomBytes(3).toString('hex').toUpperCase();
