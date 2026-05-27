import type { WebSocketServer } from 'ws';
import type { WsSession } from './ws-session.js';

export function startHeartbeat(server: WebSocketServer, sessions: Map<string, WsSession>) {
  const interval = setInterval(() => {
    for (const session of sessions.values()) {
      if (!session.alive) {
        session.socket.terminate();
        sessions.delete(session.connectionId);
        continue;
      }
      session.alive = false;
      session.socket.ping();
    }
  }, 30000);

  server.on('close', () => clearInterval(interval));
}
