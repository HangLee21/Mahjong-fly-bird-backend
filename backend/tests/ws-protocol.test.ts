import { describe, expect, it } from 'vitest';
import { WsClientMessageSchema } from '../src/websocket/ws-protocol.js';

describe('websocket protocol', () => {
  it('accepts game actions addressed by gameId', () => {
    const parsed = WsClientMessageSchema.parse({
      type: 'GAME_ACTION',
      gameId: 'game_1',
      action: { type: 'DISCARD', tile: 31 }
    });

    expect(parsed.type).toBe('GAME_ACTION');
    if (parsed.type === 'GAME_ACTION') expect(parsed.gameId).toBe('game_1');
  });

  it('requires either roomId or gameId for game actions', () => {
    expect(() =>
      WsClientMessageSchema.parse({
        type: 'GAME_ACTION',
        action: { type: 'DISCARD', tile: 31 }
      })
    ).toThrow();
  });

  it('accepts an explicit room leave message', () => {
    expect(
      WsClientMessageSchema.parse({
        type: 'ROOM_LEAVE',
        roomId: '123456',
        requestId: 'leave-1'
      })
    ).toEqual({
      type: 'ROOM_LEAVE',
      roomId: '123456',
      requestId: 'leave-1'
    });
  });
});
