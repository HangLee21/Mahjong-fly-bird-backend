import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { ZodError } from 'zod';
import { AppError, errorResponse } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { env } from '../config/env.js';
import { gameService } from '../game/game.service.js';
import { presentRoom } from '../rooms/room.presenter.js';
import { RoomService } from '../rooms/room.service.js';
import { authFromWsUrl } from './ws-auth.js';
import { setBroadcaster, type Broadcaster } from './ws-broadcast.js';
import { startHeartbeat } from './ws-heartbeat.js';
import { WsClientMessageSchema, type WsServerMessage } from './ws-protocol.js';
import type { WsSession } from './ws-session.js';

function send(socket: WebSocket, message: WsServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function registerWebSocketServer(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const sessions = new Map<string, WsSession>();
  const rooms = new RoomService();

  const broadcaster: Broadcaster = {
    sendGameView(roomId, userId, view) {
      for (const session of sessions.values()) {
        if (session.userId === userId && session.rooms.has(roomId)) {
          send(session.socket, { type: 'GAME_VIEW', roomId, payload: view });
        }
      }
    },
    broadcastRoom(roomId, event, payload) {
      for (const session of sessions.values()) {
        if (session.rooms.has(roomId)) {
          send(session.socket, { type: event as 'GAME_EVENT', roomId, payload });
        }
      }
    }
  };
  setBroadcaster(broadcaster);
  startHeartbeat(wss, sessions);

  wss.on('connection', (socket, request) => {
    try {
      const auth = authFromWsUrl(request.url);
      const session: WsSession = {
        connectionId: randomUUID(),
        socket,
        userId: auth.userId,
        openid: auth.openid,
        rooms: new Set(),
        alive: true
      };
      sessions.set(session.connectionId, session);

      socket.on('pong', () => {
        session.alive = true;
      });

      socket.on('message', async (raw) => {
        try {
          const message = WsClientMessageSchema.parse(JSON.parse(raw.toString()));
          if (message.type === 'PING') {
            send(socket, { type: 'PONG', requestId: message.requestId });
            return;
          }
          if (message.type === 'ROOM_SUBSCRIBE') {
            const room = await rooms.getRoom(message.roomId);
            if (!room.seats.some((seat) => seat.userId === session.userId)) {
              throw new AppError('ROOM_NOT_JOINED', 'User is not in room.', 403);
            }
            session.rooms.add(room.id);
            const view = await gameService.resumeGame(room.id, session.userId).catch(() => null);
            send(socket, {
              type: 'ACK',
              requestId: message.requestId,
              payload: { roomId: room.roomCode, internalRoomId: room.id }
            });
            if (view) send(socket, { type: 'GAME_VIEW', roomId: room.roomCode, payload: view });
            return;
          }
          if (message.type === 'ROOM_LEAVE') {
            const room = await rooms.getRoom(message.roomId);
            const result = await rooms.leaveRoom(room.id, session.userId);
            session.rooms.delete(room.id);
            send(socket, {
              type: 'ACK',
              requestId: message.requestId,
              payload: 'deleted' in result ? result : presentRoom(result)
            });
            return;
          }
          if (message.type === 'GAME_ACTION') {
            const action = message.action ?? message.payload;
            if (!action) throw new Error('GAME_ACTION requires action or payload.');
            const view = message.roomId
              ? await gameService.submitAction(message.roomId, session.userId, action)
              : await gameService.submitActionByGameId(message.gameId!, session.userId, action);
            send(socket, { type: 'ACK', requestId: message.requestId, payload: view });
          }
        } catch (error) {
          logger.error({ error }, 'WebSocket message handling failed');
          if (error instanceof ZodError) {
            send(socket, {
              type: 'ERROR',
              code: 'ILLEGAL_ACTION',
              message: 'Invalid websocket message.',
              details: error.flatten()
            });
            return;
          }
          const normalized = errorResponse(error);
          send(socket, {
            type: 'ERROR',
            code: String(normalized.body.code),
            message: String(normalized.body.message),
            details: normalized.body.details
          });
        }
      });

      socket.on('close', () => {
        const subscribedRooms = [...session.rooms];
        sessions.delete(session.connectionId);
        for (const roomId of subscribedRooms) {
          scheduleDisconnectedPlayerCleanup(sessions, rooms, session.userId, roomId);
        }
      });
    } catch (error) {
      const normalized = errorResponse(error);
      send(socket, { type: 'ERROR', code: String(normalized.body.code), message: String(normalized.body.message) });
      socket.close();
    }
  });

  return wss;
}

function scheduleDisconnectedPlayerCleanup(
  sessions: Map<string, WsSession>,
  rooms: RoomService,
  userId: string,
  roomId: string
) {
  const timer = setTimeout(async () => {
    const reconnected = [...sessions.values()].some(
      (session) => session.userId === userId && session.rooms.has(roomId)
    );
    if (reconnected) return;

    try {
      await rooms.leaveRoom(roomId, userId);
      logger.info({ roomId, userId }, 'Disconnected player was removed from room');
    } catch (error) {
      const normalized = errorResponse(error);
      if (!['ROOM_NOT_FOUND', 'ROOM_NOT_JOINED'].includes(String(normalized.body.code))) {
        logger.warn({ error, roomId, userId }, 'Failed to clean up disconnected player room');
      }
    }
  }, env.ROOM_DISCONNECT_GRACE_MS);
  timer.unref();
}
