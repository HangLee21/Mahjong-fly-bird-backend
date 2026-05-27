import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { errorResponse } from '../common/errors.js';
import { gameService } from '../game/game.service.js';
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
            session.rooms.add(message.roomId);
            const view = await gameService.resumeGame(message.roomId, session.userId).catch(() => null);
            send(socket, { type: 'ACK', requestId: message.requestId, payload: { roomId: message.roomId } });
            if (view) send(socket, { type: 'GAME_VIEW', roomId: message.roomId, payload: view });
            return;
          }
          if (message.type === 'GAME_ACTION') {
            const view = await gameService.submitAction(message.roomId, session.userId, message.action);
            send(socket, { type: 'ACK', requestId: message.requestId, payload: view });
          }
        } catch (error) {
          const normalized = errorResponse(error);
          send(socket, {
            type: 'ERROR',
            code: String(normalized.body.code),
            message: String(normalized.body.message),
            details: normalized.body.details
          });
        }
      });

      socket.on('close', () => sessions.delete(session.connectionId));
    } catch (error) {
      const normalized = errorResponse(error);
      send(socket, { type: 'ERROR', code: String(normalized.body.code), message: String(normalized.body.message) });
      socket.close();
    }
  });

  return wss;
}
