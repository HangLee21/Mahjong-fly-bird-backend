# HTTP API

## Auth

- `POST /api/auth/wechat-login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`

`wechat-login` accepts:

```json
{ "code": "dev_user", "nickname": "Dev" }
```

When `WECHAT_MOCK_LOGIN=true`, the backend maps the code to `openid=mock_<code>`.

## Rooms

- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `POST /api/rooms/:roomId/join`
- `POST /api/rooms/:roomId/leave`
- `POST /api/rooms/:roomId/add-ai`
- `POST /api/rooms/:roomId/start`

## Game

- `GET /api/rooms/:roomId/game`
- `POST /api/rooms/:roomId/game/actions`

Action body:

```json
{ "type": "DISCARD", "tile": 12, "clientSeq": 1 }
```

## Replay

- `GET /api/replays/:gameId`

## Admin

- `GET /api/admin/games/export?from=2026-05-01&to=2026-05-21`
- `GET /api/admin/models`

Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`.
