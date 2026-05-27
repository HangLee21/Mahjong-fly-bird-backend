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
  | 'KONG_ADDED';

export interface GameAction {
  type: ActionType;
  tile?: number;
  actionId: number;
  extra?: Record<string, unknown>;
}

export const ClientActionSchema = z.object({
  type: z.enum([
    'DISCARD',
    'PASS',
    'WIN',
    'PONG',
    'CHOW_LEFT',
    'CHOW_MIDDLE',
    'CHOW_RIGHT',
    'KONG_EXPOSED',
    'KONG_CONCEALED',
    'KONG_ADDED'
  ]),
  tile: z.number().int().min(0).max(33).optional(),
  clientSeq: z.number().int().nonnegative().optional()
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
  KONG_ADDED: 108
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
  const action = { type: input.type, tile: input.tile } as Pick<GameAction, 'type' | 'tile'>;
  return { ...action, actionId: encodeAction(action) };
}

export function sameAction(a: GameAction, b: GameAction) {
  return a.type === b.type && a.tile === b.tile;
}
