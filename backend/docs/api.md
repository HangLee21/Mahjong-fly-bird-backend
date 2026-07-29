# HTTP / WebSocket API

完整前端接入契约维护在仓库根目录：

```text
backend_api_contract.md
```

本文件保留为后端 docs 入口，避免维护两份不一致的 API 文档。

## Base URL

```text
http://<host>:3000/api
```

## WebSocket

```text
ws://<host>:3000/ws?token=<jwt>
```

## Frontend Integration Flow

```text
1. GET /app/bootstrap
2. POST /auth/wechat-login
3. GET /auth/session
4. GET /lobby/summary
5. POST /rooms
6. POST /rooms/{roomId}/add-ai
7. POST /rooms/{roomId}/start
8. Connect WebSocket
9. Send ROOM_SUBSCRIBE
10. Consume GAME_VIEW
11. Submit GAME_ACTION according to legalActions
```

## Main API Groups

- App: `/app/bootstrap`
- Auth: `/auth/wechat-login`, `/auth/session`, `/auth/refresh`, `/auth/me`
- Lobby: `/lobby/summary`
- Rooms: `/rooms`, `/rooms/{roomId}`, `/rooms/{roomId}/preview`, `/join`, `/leave`, `/add-ai`, `/start`
- Games: `/games/{gameId}/view`, `/games/{gameId}/actions`
- Replay: `/replays`, `/replays/{gameId}`
- Admin: `/admin/*`

See `../../backend_api_contract.md` for request and response schemas.
