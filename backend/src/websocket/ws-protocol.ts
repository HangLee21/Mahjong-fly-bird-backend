import { z } from 'zod';
import { ClientActionSchema } from '../rules/actions.js';

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PING'), requestId: z.string().optional() }),
  z.object({ type: z.literal('ROOM_SUBSCRIBE'), roomId: z.string(), requestId: z.string().optional() }),
  z.object({ type: z.literal('GAME_ACTION'), roomId: z.string(), action: ClientActionSchema, requestId: z.string().optional() })
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export type WsServerMessage =
  | { type: 'PONG'; requestId?: string }
  | { type: 'ACK'; requestId?: string; payload?: unknown }
  | { type: 'ERROR'; requestId?: string; code: string; message: string; details?: unknown }
  | { type: 'GAME_VIEW'; roomId: string; payload: unknown }
  | { type: 'GAME_EVENT'; roomId: string; payload: unknown };
