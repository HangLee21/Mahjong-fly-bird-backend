# WebSocket Protocol

Connect to:

```text
ws://localhost:3000/ws?token=<jwt>
```

Client messages:

```json
{ "type": "PING", "requestId": "1" }
```

```json
{ "type": "ROOM_SUBSCRIBE", "roomId": "room_id", "requestId": "2" }
```

```json
{
  "type": "GAME_ACTION",
  "roomId": "room_id",
  "requestId": "3",
  "action": { "type": "DISCARD", "tile": 12, "clientSeq": 1 }
}
```

Server messages:

- `PONG`
- `ACK`
- `ERROR`
- `GAME_VIEW`
- `GAME_EVENT`

Each user only receives their own `PlayerGameView`. Other players are represented by public fields such as `handCount`, melds, discards, and status.
