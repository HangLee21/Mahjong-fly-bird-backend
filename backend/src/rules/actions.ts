import { z } from 'zod';

export type ActionType =
  | 'DISCARD'
  | 'PASS'
  | 'WIN'
  | 'PONG'
  | 'CHOW_LEFT'
  | 'CHOW_MIDDLE'
  | 'CHOW_RIGHT'
  | 'KONG_EXPOSED'
  | 'KONG_CONCEALED'
  | 'KONG_ADDED'
  | 'SELECT_KONG_TILE';

export interface GameAction {
  type: ActionType;
  tile?: number;
  actionId: number;
  extra?: Record<string, unknown>;
}

const ActionTypeSchema = z.enum([
  'DISCARD',
  'PASS',
  'WIN',
  'PONG',
  'CHOW_LEFT',
  'CHOW_MIDDLE',
  'CHOW_RIGHT',
  'KONG_EXPOSED',
  'KONG_CONCEALED',
  'KONG_ADDED',
  'SELECT_KONG_TILE'
]);

export const ClientActionSchema = z.object({
  type: ActionTypeSchema.optional(),
  tile: z.number().int().min(0).max(33).optional(),
  actionId: z.number().int().optional(),
  extra: z.record(z.unknown()).optional(),
  clientSeq: z.number().int().nonnegative().optional()
}).refine((input) => input.type !== undefined || input.actionId !== undefined, {
  message: 'Action requires type or actionId.'
});

export type ClientAction = z.infer<typeof ClientActionSchema>;

const fixedActionIds: Record<Exclude<ActionType, 'DISCARD'>, number> = {
  PASS: 100,
  WIN: 101,
  PONG: 102,
  CHOW_LEFT: 103,
  CHOW_MIDDLE: 104,
  CHOW_RIGHT: 105,
  KONG_EXPOSED: 106,
  KONG_CONCEALED: 107,
  KONG_ADDED: 108,
  SELECT_KONG_TILE: 109
};

export function encodeAction(action: Pick<GameAction, 'type' | 'tile'>): number {
  if (action.type === 'DISCARD') {
    if (action.tile === undefined) throw new Error('DISCARD requires tile.');
    return action.tile;
  }
  return fixedActionIds[action.type];
}

export function decodeAction(actionId: number): GameAction {
  if (actionId >= 0 && actionId <= 33) return { type: 'DISCARD', tile: actionId, actionId };
  const found = Object.entries(fixedActionIds).find(([, id]) => id === actionId);
  if (!found) throw new Error(`Unknown action id: ${actionId}`);
  return { type: found[0] as ActionType, actionId };
}

export function normalizeClientAction(input: ClientAction): GameAction {
  if (!input.type && input.actionId !== undefined) return decodeAction(input.actionId);
  if (!input.type) throw new Error('Action requires type or actionId.');
  if (input.type === 'DISCARD' && input.tile === undefined && input.actionId !== undefined) {
    const decoded = decodeAction(input.actionId);
    if (decoded.type === 'DISCARD') return decoded;
  }
  const action = { type: input.type, tile: input.tile } as Pick<GameAction, 'type' | 'tile'>;
  return { ...action, actionId: encodeAction(action) };
}

export function sameAction(a: GameAction, b: GameAction) {
  return a.type === b.type && a.tile === b.tile;
}
