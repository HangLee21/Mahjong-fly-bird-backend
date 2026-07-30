import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const boolFromEnv = z.preprocess((value) => {
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return value;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/mahjong'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('dev_secret'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  WECHAT_APP_ID: z.string().default('replace_me'),
  WECHAT_APP_SECRET: z.string().default('replace_me'),
  WECHAT_MOCK_LOGIN: boolFromEnv.default(true),
  WECHAT_API_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),
  AI_SERVICE_URL: z.string().default('http://localhost:8001'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().default(3000),
  MAX_AI_ACTIONS_PER_TICK: z.coerce.number().default(20),
  ROOM_LOCK_TTL_MS: z.coerce.number().int().min(1000).default(30000),
  ROOM_DISCONNECT_GRACE_MS: z.coerce.number().int().min(0).default(60000),
  DEFAULT_RULE_VERSION: z.string().default('qujing-fei-xiaoji-v1.5'),
  DEFAULT_OBSERVATION_VERSION: z.string().default('obs_v1'),
  DEFAULT_ACTION_VERSION: z.string().default('action_v1'),
  ADMIN_TOKEN: z.string().default('dev_admin_token'),
  LOG_LEVEL: z.string().default('info')
});

export const env = EnvSchema.parse(process.env);
