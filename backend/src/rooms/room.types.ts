export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED' | 'CLOSED';
export type SeatStatus = 'EMPTY' | 'OCCUPIED' | 'READY' | 'OFFLINE';

export interface RoomConfig {
  maxPlayers: number;
  allowAi: boolean;
}
