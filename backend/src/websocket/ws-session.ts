import type WebSocket from 'ws';

export interface WsSession {
  connectionId: string;
  socket: WebSocket;
  userId: string;
  openid: string;
  rooms: Set<string>;
  alive: boolean;
}
