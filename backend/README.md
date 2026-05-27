# Mahjong Fly Bird Backend

TypeScript backend for a WeChat mini-program Mahjong game. The first version uses a mock rule engine that supports a complete real-time loop: mock login, room creation, AI seats, game start, validated discards, AI fallback moves, WebSocket views, and replay export.

## Stack

- Node.js 20+
- Fastify HTTP API
- Native WebSocket via `ws`
- Prisma + PostgreSQL
- Redis for room state and locks
- Zod, Pino, Vitest

## Quick Start

```bash
cp .env.example .env
npm install
docker-compose up -d
npm run prisma:generate
npm run prisma:migrate
npm run seed
npm run dev
```

Health check:

```bash
curl http://localhost:3000/api/health
```

Tests:

```bash
npm test
```

## Minimal Loop

1. `POST /api/auth/wechat-login` with `{ "code": "dev_user" }`
2. `POST /api/rooms` with `Authorization: Bearer <token>`
3. `POST /api/rooms/:roomId/add-ai` three times
4. `POST /api/rooms/:roomId/start`
5. Connect `ws://localhost:3000/ws?token=<token>`
6. Send `ROOM_SUBSCRIBE`
7. Send `GAME_ACTION` with a legal discard from the received `GAME_VIEW`
8. Query `GET /api/replays/:gameId`

The mock rule engine is intentionally small. It is isolated behind `RuleEngine`, so a real custom Mahjong rule implementation can replace it without changing HTTP, WebSocket, AI, or replay boundaries.
