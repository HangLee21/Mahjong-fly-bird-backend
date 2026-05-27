import type { PlayerGameView } from '../game/game.types.js';

export interface Broadcaster {
  sendGameView(roomId: string, userId: string | undefined, view: PlayerGameView): void;
  broadcastRoom(roomId: string, event: string, payload: unknown): void;
}

class NoopBroadcaster implements Broadcaster {
  sendGameView() {}
  broadcastRoom() {}
}

let activeBroadcaster: Broadcaster = new NoopBroadcaster();

export function setBroadcaster(broadcaster: Broadcaster) {
  activeBroadcaster = broadcaster;
}

export function getBroadcaster() {
  return activeBroadcaster;
}
