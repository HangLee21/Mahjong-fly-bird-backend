# 后端架构技术路线文档：Custom Mahjong Backend

> 用途：本文件用于指导 Codex 在 `backend/` 文件夹中搭建麻将小程序后端。  
> 目标：实现一个可支撑微信小程序联机对局、AI 对局、规则校验、房间管理、牌谱记录、模型调用和后续训练数据沉淀的后端系统。  
> 范围：本文件只覆盖后端，不覆盖小程序前端，也不覆盖模型训练代码。

---

## 0. 后端定位

后端是整个麻将系统的裁判、状态管理者和 AI 调度者。

它需要负责：

```text
1. 用户登录与会话；
2. 房间创建、加入、退出、重连；
3. 牌局状态管理；
4. 麻将规则校验；
5. 动作流转；
6. 吃、碰、杠、胡等响应优先级处理；
7. 结算与牌谱保存；
8. AI 玩家接管；
9. 调用训练侧导出的 AI 推理服务；
10. WebSocket 实时同步牌桌状态；
11. 防作弊与状态一致性；
12. 线上日志和回放数据沉淀。
```

核心原则：

```text
前端只负责展示和用户输入；
后端负责规则与状态；
AI 只提供动作建议；
最终裁决永远由后端规则引擎完成；
每一步动作必须可回放、可审计、可复现。
```

---

## 1. 推荐技术栈

### 1.1 默认技术栈

建议后端使用：

```text
Node.js 20+
TypeScript
Fastify
ws 原生 WebSocket
Prisma
PostgreSQL
Redis
Zod
Pino
Vitest
Docker Compose
```

选择理由：

```text
TypeScript：类型明确，适合复杂游戏状态；
Fastify：轻量、高性能，适合 HTTP API；
ws：使用原生 WebSocket 协议，方便微信小程序连接；
Prisma：简化数据库 schema 和 migration；
PostgreSQL：存储用户、房间、牌谱、模型版本；
Redis：存储实时房间状态、分布式锁、短期连接状态；
Zod：请求参数校验；
Pino：结构化日志；
Vitest：单元测试；
Docker Compose：本地一键启动数据库和 Redis。
```

### 1.2 为什么不用 Socket.IO

微信小程序原生支持 WebSocket，但 Socket.IO 不是纯 WebSocket 协议，它有自己的握手和事件协议。  
为了减少小程序端适配成本，后端第一版直接使用原生 WebSocket JSON 消息协议。

### 1.3 AI 推理服务如何接入

训练侧模型建议独立部署为 Python 推理服务：

```text
training/inference service
POST /ai/act
```

后端通过 HTTP 调用 AI 服务。

后端不直接加载 PyTorch 模型，不直接参与模型训练。

---

## 2. 总体架构

```text
微信小程序
  │
  │ HTTPS / WSS
  ↓
Backend API Gateway
  │
  ├── Auth Module
  ├── User Module
  ├── Room Module
  ├── Game Module
  ├── Rule Engine
  ├── AI Gateway
  ├── Replay Module
  ├── Matchmaking Module
  └── Admin Module
  │
  ├── PostgreSQL：长期数据
  ├── Redis：实时状态、锁、连接状态
  └── AI Inference Service：模型动作
```

后端内部应该分为三类逻辑：

```text
1. 实时逻辑：房间状态、动作流转、WebSocket 广播；
2. 持久化逻辑：用户、牌谱、对局结果、模型版本；
3. 规则逻辑：合法动作、状态转移、结算。
```

---

## 3. 推荐目录结构

Codex 应在 `backend/` 文件夹中实现如下结构：

```text
backend/
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── docker-compose.yml
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts
│   ├── app.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── constants.ts
│   ├── common/
│   │   ├── errors.ts
│   │   ├── logger.ts
│   │   ├── result.ts
│   │   ├── time.ts
│   │   └── ids.ts
│   ├── auth/
│   │   ├── auth.routes.ts
│   │   ├── auth.service.ts
│   │   ├── jwt.ts
│   │   └── wechat.service.ts
│   ├── users/
│   │   ├── user.model.ts
│   │   ├── user.repository.ts
│   │   └── user.service.ts
│   ├── rooms/
│   │   ├── room.routes.ts
│   │   ├── room.service.ts
│   │   ├── room.repository.ts
│   │   └── room.types.ts
│   ├── game/
│   │   ├── game.routes.ts
│   │   ├── game.service.ts
│   │   ├── game.types.ts
│   │   ├── game.state.ts
│   │   ├── game.serializer.ts
│   │   └── game.snapshot.ts
│   ├── rules/
│   │   ├── rule-engine.ts
│   │   ├── rule.types.ts
│   │   ├── tile.ts
│   │   ├── actions.ts
│   │   ├── legal-actions.ts
│   │   ├── transition.ts
│   │   ├── scoring.ts
│   │   └── rule-fixtures/
│   ├── ai/
│   │   ├── ai.routes.ts
│   │   ├── ai-gateway.ts
│   │   ├── observation.builder.ts
│   │   ├── ai.types.ts
│   │   └── fallback-policy.ts
│   ├── websocket/
│   │   ├── ws-server.ts
│   │   ├── ws-session.ts
│   │   ├── ws-protocol.ts
│   │   ├── ws-auth.ts
│   │   ├── ws-broadcast.ts
│   │   └── ws-heartbeat.ts
│   ├── replay/
│   │   ├── replay.routes.ts
│   │   ├── replay.service.ts
│   │   ├── replay.repository.ts
│   │   └── replay.types.ts
│   ├── storage/
│   │   ├── prisma.ts
│   │   ├── redis.ts
│   │   ├── room-state-store.ts
│   │   └── locks.ts
│   ├── admin/
│   │   ├── admin.routes.ts
│   │   └── model-version.service.ts
│   └── tests/
│       ├── rule-engine.test.ts
│       ├── legal-actions.test.ts
│       ├── transition.test.ts
│       ├── scoring.test.ts
│       ├── room.service.test.ts
│       ├── game.service.test.ts
│       ├── ai-gateway.test.ts
│       └── ws-protocol.test.ts
├── scripts/
│   ├── dev.sh
│   ├── migrate.sh
│   ├── seed.ts
│   └── export-rule-fixtures.ts
└── docs/
    ├── api.md
    ├── websocket_protocol.md
    ├── rule_engine.md
    ├── database_schema.md
    ├── ai_integration.md
    └── deployment.md
```

---

## 4. 后端模块职责

### 4.1 Auth Module

负责：

```text
微信小程序登录；
openid 绑定用户；
签发后端 JWT；
刷新 session；
校验 WebSocket token。
```

主要接口：

```text
POST /api/auth/wechat-login
POST /api/auth/refresh
GET  /api/auth/me
```

### 4.2 Room Module

负责：

```text
创建房间；
加入房间；
退出房间；
房主开始游戏；
添加 AI 玩家；
房间座位管理；
房间状态保存。
```

主要接口：

```text
POST /api/rooms
POST /api/rooms/:roomId/join
POST /api/rooms/:roomId/leave
POST /api/rooms/:roomId/start
POST /api/rooms/:roomId/add-ai
GET  /api/rooms/:roomId
```

### 4.3 Game Module

负责：

```text
创建 GameState；
处理玩家动作；
调用规则引擎；
更新房间状态；
触发 AI 行动；
生成玩家视角；
广播状态变更；
生成牌谱日志。
```

核心方法：

```ts
startGame(roomId: string): Promise<GameView>
submitAction(roomId: string, userId: string, action: ClientAction): Promise<ActionResult>
getGameView(roomId: string, userId: string): Promise<PlayerGameView>
resumeGame(roomId: string, userId: string): Promise<PlayerGameView>
```

### 4.4 Rule Engine

负责：

```text
牌墙生成；
发牌；
动作合法性判断；
状态转移；
吃碰杠胡响应优先级；
终局判断；
计分结算。
```

规则引擎必须是纯逻辑模块：

```text
不访问数据库；
不访问 Redis；
不调用 AI；
不依赖 WebSocket；
输入 state + action；
输出 nextState + events。
```

### 4.5 AI Gateway

负责：

```text
把 GameState 转成 AI observation；
请求 AI 推理服务；
拿到 action；
做 fallback；
返回后端游戏服务；
记录模型版本和推理延迟。
```

后端仍然必须二次校验 AI 返回动作。

### 4.6 WebSocket Module

负责：

```text
客户端连接；
token 鉴权；
加入 room channel；
接收动作消息；
广播房间状态；
心跳；
断线重连；
连接清理。
```

### 4.7 Replay Module

负责：

```text
保存每一步动作；
保存状态 hash；
保存玩家视角 observation；
保存 legal_actions；
保存 AI 模型版本；
支持对局回放；
支持训练数据导出。
```

---

## 5. 数据库设计

使用 PostgreSQL + Prisma。

### 5.1 User

```prisma
model User {
  id          String   @id @default(cuid())
  openid      String   @unique
  unionid     String?
  nickname    String?
  avatarUrl   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  seats       RoomSeat[]
  games       GamePlayer[]
}
```

### 5.2 Room

```prisma
model Room {
  id          String   @id @default(cuid())
  roomCode    String   @unique
  status      String   // WAITING, PLAYING, FINISHED, CLOSED
  ownerId     String
  ruleVersion String
  configJson  Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  seats       RoomSeat[]
  games       Game[]
}
```

### 5.3 RoomSeat

```prisma
model RoomSeat {
  id          String   @id @default(cuid())
  roomId      String
  seatIndex   Int
  userId      String?
  isAI        Boolean  @default(false)
  aiLevel     String?
  aiModel     String?
  status      String   // EMPTY, OCCUPIED, READY, OFFLINE

  room        Room     @relation(fields: [roomId], references: [id])
  user        User?    @relation(fields: [userId], references: [id])

  @@unique([roomId, seatIndex])
}
```

### 5.4 Game

```prisma
model Game {
  id              String   @id @default(cuid())
  roomId          String
  status          String   // PLAYING, FINISHED, ABORTED
  ruleVersion     String
  observationVer  String
  actionVersion   String
  seed            String
  startedAt       DateTime @default(now())
  finishedAt      DateTime?
  finalScoreJson  Json?
  resultJson      Json?

  room            Room     @relation(fields: [roomId], references: [id])
  players         GamePlayer[]
  steps           GameStep[]
}
```

### 5.5 GamePlayer

```prisma
model GamePlayer {
  id          String   @id @default(cuid())
  gameId      String
  userId      String?
  seatIndex   Int
  isAI        Boolean  @default(false)
  aiModel     String?
  initialScore Int     @default(0)
  finalScore   Int?

  game        Game     @relation(fields: [gameId], references: [id])
  user        User?    @relation(fields: [userId], references: [id])

  @@unique([gameId, seatIndex])
}
```

### 5.6 GameStep

```prisma
model GameStep {
  id              String   @id @default(cuid())
  gameId          String
  stepIndex       Int
  playerIndex     Int
  actionJson      Json
  legalActionsJson Json
  publicViewJson  Json
  privateViewJson Json?
  stateHashBefore String
  stateHashAfter  String
  rewardJson      Json?
  aiModel         String?
  actionSource    String   // HUMAN, AI, FALLBACK, SYSTEM
  createdAt       DateTime @default(now())

  game            Game     @relation(fields: [gameId], references: [id])

  @@unique([gameId, stepIndex])
}
```

### 5.7 ModelVersion

```prisma
model ModelVersion {
  id              String   @id @default(cuid())
  name            String   @unique
  status          String   // ACTIVE, INACTIVE, TESTING
  endpoint        String
  ruleVersion     String
  observationVer  String
  actionVersion   String
  metadataJson    Json
  createdAt       DateTime @default(now())
}
```

---

## 6. Redis 设计

Redis 不作为最终事实来源，但用于实时状态和锁。

### 6.1 Key 设计

```text
room:{roomId}:state
room:{roomId}:connections
room:{roomId}:lock
user:{userId}:connection
game:{gameId}:latest_step
ws:{connectionId}:session
```

### 6.2 房间状态缓存

```json
{
  "roomId": "room_001",
  "gameId": "game_001",
  "status": "PLAYING",
  "state": {},
  "version": 35,
  "updatedAt": 1780000000
}
```

### 6.3 分布式锁

所有改变牌局状态的操作必须获得房间锁：

```text
lock key: room:{roomId}:lock
ttl: 3000ms
```

处理流程：

```text
1. 获取 room lock；
2. 读取当前 state；
3. 校验动作；
4. 执行规则转移；
5. 写入 Redis；
6. 持久化 GameStep；
7. 广播状态；
8. 释放 lock。
```

注意：

```text
任何玩家动作、AI 动作、重连恢复都不能绕过房间状态版本号。
```

---

## 7. 核心 GameState 设计

文件：

```text
src/game/game.state.ts
```

### 7.1 GameState

```ts
export interface GameState {
  gameId: string;
  roomId: string;
  ruleVersion: string;
  seed: string;

  status: 'INIT' | 'PLAYING' | 'WAITING_RESPONSE' | 'FINISHED';

  players: PlayerState[];
  wall: number[];
  deadWall?: number[];

  currentPlayer: number;
  dealer: number;
  roundIndex: number;
  stepIndex: number;

  lastAction?: GameAction;
  lastDiscard?: {
    tile: number;
    fromPlayer: number;
    stepIndex: number;
  };

  pendingResponses?: PendingResponse[];

  scores: number[];

  createdAt: number;
  updatedAt: number;
}
```

### 7.2 PlayerState

```ts
export interface PlayerState {
  seatIndex: number;
  userId?: string;
  isAI: boolean;
  aiModel?: string;

  hand: number[];
  melds: Meld[];
  discards: number[];

  status: 'ACTIVE' | 'OFFLINE' | 'LEFT';

  isReady?: boolean;
}
```

### 7.3 Meld

```ts
export interface Meld {
  type: 'CHOW' | 'PONG' | 'KONG_EXPOSED' | 'KONG_CONCEALED' | 'KONG_ADDED';
  tiles: number[];
  fromPlayer?: number;
  stepIndex: number;
}
```

### 7.4 PendingResponse

```ts
export interface PendingResponse {
  playerIndex: number;
  availableActions: GameAction[];
  priority: number;
  deadlineAt?: number;
}
```

---

## 8. 动作协议设计

### 8.1 服务端内部动作 GameAction

文件：

```text
src/rules/actions.ts
```

```ts
export type ActionType =
  | 'DISCARD'
  | 'PASS'
  | 'WIN'
  | 'PONG'
  | 'CHOW_LEFT'
  | 'CHOW_MIDDLE'
  | 'CHOW_RIGHT'
  | 'KONG_EXPOSED'
  | 'KONG_CONCEALED'
  | 'KONG_ADDED';

export interface GameAction {
  type: ActionType;
  tile?: number;
  actionId: number;
  extra?: Record<string, unknown>;
}
```

### 8.2 客户端提交动作

客户端只提交动作意图，后端负责校验：

```json
{
  "type": "DISCARD",
  "tile": 12,
  "clientSeq": 35
}
```

后端转换成内部 GameAction：

```ts
const action = normalizeClientAction(input);
```

### 8.3 动作编码必须与训练侧一致

后端动作编码必须和训练侧 `actions.py` 一致：

```text
0 ~ N_TILE_TYPES-1：DISCARD tile
100：PASS
101：WIN
102：PONG
103：CHOW_LEFT
104：CHOW_MIDDLE
105：CHOW_RIGHT
106：KONG_EXPOSED
107：KONG_CONCEALED
108：KONG_ADDED
```

后端必须提供：

```ts
encodeAction(action: GameAction): number
decodeAction(actionId: number): GameAction
```

并用单元测试保证与训练侧 fixtures 一致。

---

## 9. 规则引擎设计

文件：

```text
src/rules/rule-engine.ts
```

### 9.1 RuleEngine 接口

```ts
export interface RuleEngine {
  createInitialState(input: CreateGameInput): GameState;

  getLegalActions(state: GameState, playerIndex: number): GameAction[];

  applyAction(
    state: GameState,
    playerIndex: number,
    action: GameAction
  ): RuleResult;

  buildPlayerView(state: GameState, playerIndex: number): PlayerGameView;

  isTerminal(state: GameState): boolean;

  score(state: GameState): ScoreResult;

  hashState(state: GameState): string;
}
```

### 9.2 RuleResult

```ts
export interface RuleResult {
  nextState: GameState;
  events: GameEvent[];
  scoreResult?: ScoreResult;
}
```

### 9.3 GameEvent

```ts
export type GameEvent =
  | { type: 'TILE_DRAWN'; playerIndex: number }
  | { type: 'TILE_DISCARDED'; playerIndex: number; tile: number }
  | { type: 'MELD_CREATED'; playerIndex: number; meld: Meld }
  | { type: 'WIN_DECLARED'; playerIndex: number }
  | { type: 'SCORE_SETTLED'; result: ScoreResult }
  | { type: 'TURN_CHANGED'; currentPlayer: number }
  | { type: 'WAITING_RESPONSE'; responses: PendingResponse[] };
```

### 9.4 规则引擎必须保持纯函数风格

`applyAction` 不应修改传入的 state，而是返回新 state：

```ts
const nextState = deepClone(state);
```

好处：

```text
便于测试；
便于回放；
便于生成 stateHashBefore / stateHashAfter；
便于调试线上异常。
```

---

## 10. 玩家视角 PlayerGameView

后端不能把完整 GameState 发给前端。

文件：

```text
src/game/game.serializer.ts
```

### 10.1 PlayerGameView

```ts
export interface PlayerGameView {
  roomId: string;
  gameId: string;
  playerIndex: number;
  status: string;
  stepIndex: number;

  dealer: number;
  currentPlayer: number;
  scores: number[];

  self: {
    hand: number[];
    melds: Meld[];
    discards: number[];
  };

  opponents: Array<{
    seatIndex: number;
    handCount: number;
    melds: Meld[];
    discards: number[];
    status: string;
  }>;

  lastDiscard?: {
    tile: number;
    fromPlayer: number;
  };

  legalActions: GameAction[];

  pendingResponses?: PendingResponse[];

  result?: ScoreResult;
}
```

### 10.2 不能泄露的信息

发送给前端的视角中不能包含：

```text
其他玩家暗手牌；
牌墙顺序；
AI observation 原始向量；
完整 state；
其他玩家可选动作；
未公开的结算中间变量。
```

---

## 11. HTTP API 设计

所有 HTTP API 使用 JSON。

基础前缀：

```text
/api
```

### 11.1 健康检查

```http
GET /api/health
```

返回：

```json
{
  "ok": true,
  "version": "0.1.0",
  "time": 1780000000
}
```

### 11.2 微信登录

```http
POST /api/auth/wechat-login
```

请求：

```json
{
  "code": "wx_login_code",
  "nickname": "optional",
  "avatarUrl": "optional"
}
```

返回：

```json
{
  "token": "jwt",
  "user": {
    "id": "user_001",
    "nickname": "xxx",
    "avatarUrl": "xxx"
  }
}
```

说明：

```text
小程序端通过 wx.login 获得临时 code；
后端用 code 调用微信 code2Session；
后端得到 openid；
后端创建或查找 User；
后端签发自己的 JWT；
后续 HTTP 和 WebSocket 均使用该 JWT。
```

### 11.3 创建房间

```http
POST /api/rooms
Authorization: Bearer <token>
```

请求：

```json
{
  "ruleVersion": "rule_v1",
  "config": {
    "maxPlayers": 4,
    "initialScore": 0,
    "allowAI": true
  }
}
```

返回：

```json
{
  "roomId": "room_001",
  "roomCode": "123456",
  "status": "WAITING"
}
```

### 11.4 加入房间

```http
POST /api/rooms/:roomId/join
Authorization: Bearer <token>
```

请求：

```json
{
  "seatIndex": 1
}
```

### 11.5 添加 AI

```http
POST /api/rooms/:roomId/add-ai
Authorization: Bearer <token>
```

请求：

```json
{
  "seatIndex": 2,
  "aiLevel": "normal",
  "model": "mahjong_ppo_v1"
}
```

### 11.6 开始游戏

```http
POST /api/rooms/:roomId/start
Authorization: Bearer <token>
```

返回：

```json
{
  "gameId": "game_001",
  "view": {}
}
```

### 11.7 提交动作

HTTP 也提供动作接口，方便测试。  
正式对局优先通过 WebSocket 提交。

```http
POST /api/games/:gameId/actions
Authorization: Bearer <token>
```

请求：

```json
{
  "type": "DISCARD",
  "tile": 12,
  "clientSeq": 36
}
```

返回：

```json
{
  "ok": true,
  "view": {},
  "events": []
}
```

### 11.8 获取当前视角

```http
GET /api/games/:gameId/view
Authorization: Bearer <token>
```

返回当前用户视角。

### 11.9 获取牌谱

```http
GET /api/replays/:gameId
Authorization: Bearer <token>
```

返回：

```json
{
  "gameId": "game_001",
  "steps": [],
  "result": {}
}
```

---

## 12. WebSocket 协议设计

WebSocket 地址：

```text
wss://your-domain.com/ws?token=<jwt>
```

本地开发：

```text
ws://localhost:3000/ws?token=<jwt>
```

### 12.1 消息格式

所有 WebSocket 消息统一格式：

```ts
export interface WsMessage<T = unknown> {
  type: string;
  requestId?: string;
  roomId?: string;
  gameId?: string;
  payload?: T;
  ts?: number;
}
```

### 12.2 客户端发送消息

#### 加入房间频道

```json
{
  "type": "ROOM_SUBSCRIBE",
  "requestId": "req_001",
  "roomId": "room_001"
}
```

#### 取消订阅

```json
{
  "type": "ROOM_UNSUBSCRIBE",
  "requestId": "req_002",
  "roomId": "room_001"
}
```

#### 提交动作

```json
{
  "type": "GAME_ACTION",
  "requestId": "req_003",
  "roomId": "room_001",
  "gameId": "game_001",
  "payload": {
    "type": "DISCARD",
    "tile": 12,
    "clientSeq": 36
  }
}
```

#### 心跳

```json
{
  "type": "PING",
  "requestId": "req_ping_001"
}
```

### 12.3 服务端返回消息

#### ACK

```json
{
  "type": "ACK",
  "requestId": "req_003",
  "payload": {
    "ok": true
  }
}
```

#### 错误

```json
{
  "type": "ERROR",
  "requestId": "req_003",
  "payload": {
    "code": "ILLEGAL_ACTION",
    "message": "Action is not legal in current state."
  }
}
```

#### 房间状态更新

```json
{
  "type": "ROOM_UPDATE",
  "roomId": "room_001",
  "payload": {
    "roomId": "room_001",
    "status": "PLAYING",
    "seats": []
  }
}
```

#### 游戏视角更新

注意：每个玩家收到的是自己的 PlayerGameView，不能广播同一个完整 state。

```json
{
  "type": "GAME_VIEW",
  "roomId": "room_001",
  "gameId": "game_001",
  "payload": {
    "view": {}
  }
}
```

#### 游戏事件

```json
{
  "type": "GAME_EVENTS",
  "roomId": "room_001",
  "gameId": "game_001",
  "payload": {
    "events": [
      {
        "type": "TILE_DISCARDED",
        "playerIndex": 0,
        "tile": 12
      }
    ]
  }
}
```

#### 心跳响应

```json
{
  "type": "PONG",
  "requestId": "req_ping_001"
}
```

### 12.4 WebSocket 连接管理

后端需要维护：

```text
connectionId → userId
userId → connectionIds
roomId → connectionIds
connectionId → subscribed roomIds
```

断线后：

```text
保留用户座位；
标记玩家 OFFLINE；
允许用户通过 JWT 重连；
重连后重新发送 PlayerGameView。
```

---

## 13. 游戏动作处理流程

### 13.1 人类玩家动作流程

```text
1. 小程序通过 WebSocket 发送 GAME_ACTION；
2. ws-server 校验 token 和 room subscription；
3. game.service 获取 room lock；
4. 从 Redis 读取 GameState；
5. 判断 userId 是否对应当前行动玩家；
6. 调用 ruleEngine.getLegalActions；
7. 校验 action 是否合法；
8. 记录 stateHashBefore；
9. 调用 ruleEngine.applyAction；
10. 写入 Redis 新状态；
11. 持久化 GameStep；
12. 根据 events 判断是否触发 AI 行动；
13. 给每个玩家广播各自 PlayerGameView；
14. 释放 room lock。
```

### 13.2 AI 玩家动作流程

```text
1. 人类动作或系统动作后，后端发现 currentPlayer 是 AI；
2. game.service 构造 AI observation；
3. ai-gateway 调用 AI 推理服务；
4. AI 服务返回 actionId；
5. 后端 decodeAction；
6. 后端再次调用 getLegalActions 校验；
7. 若非法，使用 fallbackPolicy；
8. 调用 ruleEngine.applyAction；
9. 保存 GameStep；
10. 广播状态；
11. 如果下一个还是 AI，则继续循环；
12. 为避免死循环，限制一次 tick 最多执行 maxAiActionsPerTick。
```

### 13.3 AI 连续行动保护

配置：

```ts
maxAiActionsPerTick = 20;
aiActionDelayMs = 300;
```

说明：

```text
如果 3 个 AI 连续行动，后端可以自动推进；
但不能无限 while；
需要限制单次 tick 步数；
必要时 setTimeout 分批执行，避免阻塞事件循环。
```

---

## 14. AI Gateway 设计

文件：

```text
src/ai/ai-gateway.ts
```

### 14.1 AI 服务请求

```http
POST {AI_SERVICE_URL}/ai/act
```

请求：

```json
{
  "room_id": "room_001",
  "game_id": "game_001",
  "player_id": 2,
  "model_version": "mahjong_ppo_v1",
  "observation": [0.0, 1.0, 0.0],
  "legal_actions": [1, 5, 9, 100]
}
```

### 14.2 AI 服务返回

```json
{
  "action": 5,
  "model_version": "mahjong_ppo_v1",
  "confidence": 0.73,
  "fallback_used": false
}
```

### 14.3 AI Gateway 接口

```ts
export interface AiGateway {
  requestAction(input: AiActionRequest): Promise<AiActionResult>;
}
```

```ts
export interface AiActionRequest {
  roomId: string;
  gameId: string;
  playerIndex: number;
  modelVersion: string;
  observation: number[];
  legalActions: number[];
}
```

```ts
export interface AiActionResult {
  actionId: number;
  modelVersion: string;
  confidence?: number;
  fallbackUsed: boolean;
  latencyMs: number;
}
```

### 14.4 fallback 策略

如果 AI 服务超时、异常或返回非法动作：

```text
1. 优先胡；
2. 否则优先过；
3. 否则选择第一个合法出牌动作；
4. 记录 actionSource = FALLBACK。
```

```ts
export function fallbackAction(legalActions: GameAction[]): GameAction {
  const win = legalActions.find(a => a.type === 'WIN');
  if (win) return win;

  const pass = legalActions.find(a => a.type === 'PASS');
  if (pass) return pass;

  return legalActions[0];
}
```

### 14.5 超时设置

```text
AI_REQUEST_TIMEOUT_MS = 1000
```

如果超时，直接 fallback。  
线上游戏不能因为模型服务阻塞而卡死牌局。

---

## 15. Observation Builder

文件：

```text
src/ai/observation.builder.ts
```

后端需要把 GameState 转成训练侧定义的 observation。

### 15.1 版本要求

必须显式维护：

```text
observationVersion
actionVersion
ruleVersion
```

AI 请求中必须带：

```json
{
  "model_version": "mahjong_ppo_v1",
  "observation_version": "obs_v1",
  "action_version": "action_v1",
  "rule_version": "rule_v1"
}
```

如果模型版本与当前规则版本不匹配，后端应拒绝使用该模型或降级到 heuristic AI。

### 15.2 构造流程

```text
1. 从 state 提取当前 AI 玩家可见信息；
2. 统计 hand_counts；
3. 统计 self_meld_counts；
4. 统计 all_discard_counts；
5. 统计 all_open_meld_counts；
6. 统计 remaining_tile_counts；
7. 编码 scores；
8. 编码 dealer；
9. 编码 currentPlayer；
10. 编码 lastDiscard；
11. 输出固定长度 number[]。
```

注意：

```text
Observation Builder 不能读取其他玩家暗手牌；
不能读取未来牌墙；
不能读取终局后验信息。
```

---

## 16. 牌谱与训练数据沉淀

每一步都要保存 GameStep。

### 16.1 为什么必须保存 legal_actions

训练数据不仅需要实际动作，也需要当时有哪些合法动作。

```text
如果没有 legal_actions，后续无法训练 action mask；
无法判断模型是否在非法动作中选择；
无法做行为克隆。
```

### 16.2 为什么保存 state hash

```text
方便回放一致性校验；
方便定位线上 bug；
方便比较后端规则和训练规则是否一致；
方便防止重复提交动作。
```

### 16.3 训练数据导出接口

```http
GET /api/admin/games/export?from=2026-05-01&to=2026-05-21
Authorization: Bearer <admin-token>
```

返回 JSONL：

```json
{"game_id":"g1","step":1,"observation":[...],"legal_actions":[...],"action":5,"reward":0}
{"game_id":"g1","step":2,"observation":[...],"legal_actions":[...],"action":100,"reward":0}
```

也可以写入文件：

```text
exports/replay_20260521.jsonl
```

---

## 17. 防作弊设计

### 17.1 前端不可信

前端提交的所有内容都不可信。

不能相信：

```text
前端说自己是谁；
前端说当前轮到谁；
前端说动作是否合法；
前端传来的手牌；
前端传来的分数；
前端传来的结算。
```

后端只接受：

```text
用户身份 token；
动作意图；
客户端序号；
房间 id / game id。
```

其他全部由后端状态计算。

### 17.2 动作幂等与防重复

客户端可能因为网络问题重复发送动作。

后端应支持：

```text
clientSeq；
state version；
stepIndex；
requestId。
```

如果重复请求已经处理过，返回同样结果或当前最新视角。

### 17.3 房间锁

所有状态改变必须在锁内执行。

```text
无锁不能处理 GAME_ACTION；
无锁不能触发 AI 动作；
无锁不能开始游戏；
无锁不能结算。
```

---

## 18. 错误码设计

统一错误结构：

```json
{
  "code": "ILLEGAL_ACTION",
  "message": "Action is not legal in current state.",
  "details": {}
}
```

常见错误码：

```text
UNAUTHORIZED
ROOM_NOT_FOUND
ROOM_FULL
ROOM_NOT_JOINED
GAME_NOT_FOUND
GAME_ALREADY_STARTED
GAME_NOT_STARTED
NOT_YOUR_TURN
ILLEGAL_ACTION
STATE_VERSION_CONFLICT
AI_SERVICE_TIMEOUT
AI_SERVICE_ERROR
RULE_ENGINE_ERROR
INTERNAL_ERROR
```

---

## 19. 配置文件

`.env.example`：

```bash
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mahjong
REDIS_URL=redis://localhost:6379

JWT_SECRET=replace_me
JWT_EXPIRES_IN=7d

WECHAT_APP_ID=replace_me
WECHAT_APP_SECRET=replace_me

AI_SERVICE_URL=http://localhost:8001
AI_REQUEST_TIMEOUT_MS=1000

DEFAULT_RULE_VERSION=rule_v1
DEFAULT_OBSERVATION_VERSION=obs_v1
DEFAULT_ACTION_VERSION=action_v1

LOG_LEVEL=debug
```

---

## 20. Docker Compose

本地开发需要一键启动 PostgreSQL 和 Redis。

`docker-compose.yml`：

```yaml
services:
  postgres:
    image: postgres:16
    container_name: mahjong_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: mahjong
    ports:
      - "5432:5432"
    volumes:
      - mahjong_pg_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    container_name: mahjong_redis
    ports:
      - "6379:6379"

volumes:
  mahjong_pg_data:
```

---

## 21. package.json 脚本

Codex 应配置：

```json
{
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
    "lint": "eslint src --ext .ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio",
    "seed": "tsx scripts/seed.ts"
  }
}
```

---

## 22. Codex 开发顺序

请 Codex 按以下顺序实现，避免一开始就写复杂功能。

### Step 1：项目初始化

```text
初始化 Node.js + TypeScript；
配置 Fastify；
配置 Prisma；
配置 Redis；
配置 Pino 日志；
配置 Vitest。
```

验收：

```text
GET /api/health 返回 ok；
npm test 能运行；
docker-compose up 能启动数据库和 Redis。
```

### Step 2：实现通用类型和错误处理

```text
common/errors.ts；
common/result.ts；
全局 error handler；
Zod 请求校验。
```

### Step 3：实现 Auth Module

```text
POST /api/auth/wechat-login；
JWT 签发；
Auth middleware；
mock wechat login 模式。
```

开发模式允许：

```text
WECHAT_MOCK_LOGIN=true
```

这样没有真实 AppID / AppSecret 时也能测试。

### Step 4：实现 Room Module

```text
创建房间；
加入房间；
离开房间；
添加 AI；
准备状态；
房主开始游戏。
```

### Step 5：实现 Rule Engine 基础骨架

先实现一个可运行的简化 Mock Rule：

```text
固定 4 个玩家；
随机牌墙；
发牌；
轮流摸打；
只支持 DISCARD / PASS；
先不实现完整胡牌；
能够跑完整动作流。
```

后续再替换为真实非标准麻将规则。

### Step 6：实现 Game Module

```text
startGame；
submitAction；
getGameView；
Redis 房间状态；
GameStep 持久化；
state hash。
```

### Step 7：实现 WebSocket

```text
/ws?token=xxx；
ROOM_SUBSCRIBE；
GAME_ACTION；
PING/PONG；
GAME_VIEW 广播；
断线重连。
```

### Step 8：实现 AI Gateway

```text
Observation Builder；
调用 AI 服务；
超时 fallback；
AI 连续行动推进；
记录 aiModel 和 latency。
```

### Step 9：实现 Replay Module

```text
查询对局；
导出 JSONL；
回放状态检查。
```

### Step 10：补充测试

```text
规则测试；
房间测试；
动作测试；
AI fallback 测试；
WebSocket 协议测试；
回放一致性测试。
```

---

## 23. 最小可运行闭环

后端第一版必须支持以下闭环：

```text
1. 用户 mock login；
2. 创建房间；
3. 加入 3 个 AI；
4. 开始游戏；
5. 用户通过 WebSocket 收到 PlayerGameView；
6. 用户提交 DISCARD；
7. 后端校验动作；
8. 后端推进 AI 行动；
9. 后端广播新的 PlayerGameView；
10. 终局后保存 Game 和 GameStep；
11. 可以通过 replay API 查询牌谱。
```

即使第一版规则还不完整，也必须保证这个闭环可运行。

---

## 24. 测试要求

### 24.1 Rule Engine Tests

```text
createInitialState 返回合法状态；
getLegalActions 不为空；
applyAction 后 stepIndex 增加；
hashState 对同一状态稳定；
玩家视角不泄露其他玩家手牌。
```

### 24.2 Game Service Tests

```text
非当前玩家不能行动；
非法动作被拒绝；
合法动作更新状态；
动作后写入 GameStep；
终局后不能继续行动。
```

### 24.3 AI Gateway Tests

```text
AI 服务正常返回时使用模型动作；
AI 超时时使用 fallback；
AI 返回非法 action 时 fallback；
fallback 返回的一定是合法动作。
```

### 24.4 WebSocket Tests

```text
无 token 不能连接；
有效 token 可以连接；
ROOM_SUBSCRIBE 成功；
GAME_ACTION 返回 ACK；
非法 GAME_ACTION 返回 ERROR；
PING 返回 PONG。
```

### 24.5 Replay Tests

```text
GameStep 顺序连续；
stateHashBefore / stateHashAfter 存在；
导出 JSONL 包含 observation、legal_actions、action；
回放可以重建终局结果。
```

---

## 25. 与训练侧的接口对齐

后端必须与训练侧保持以下版本一致：

```text
ruleVersion
observationVersion
actionVersion
tileEncodingVersion
```

### 25.1 动作编码一致

后端：

```text
src/rules/actions.ts
```

训练侧：

```text
mahjong_ai/env/actions.py
```

必须通过 fixtures 对齐。

### 25.2 Observation 一致

后端：

```text
src/ai/observation.builder.ts
```

训练侧：

```text
mahjong_ai/env/observation.py
```

必须通过 fixtures 对齐。

### 25.3 规则一致

如果训练侧不能直接复用 TypeScript 规则引擎，则后端需要导出规则 fixtures：

```bash
npm run export-rule-fixtures
```

输出：

```text
fixtures/rule_cases/case_001.json
fixtures/rule_cases/case_002.json
```

每个 case 包含：

```json
{
  "state": {},
  "playerIndex": 0,
  "legalActions": [1, 2, 3, 100],
  "action": 1,
  "nextStateHash": "xxx",
  "score": null
}
```

训练侧用这些 fixtures 做一致性测试。

---

## 26. 部署建议

### 26.1 开发环境

```text
backend：localhost:3000
postgres：localhost:5432
redis：localhost:6379
ai-service：localhost:8001
```

### 26.2 生产环境

建议部署为：

```text
backend API + WebSocket：Docker 容器
PostgreSQL：云数据库
Redis：云 Redis
AI service：独立 Python 容器
对象存储：保存导出的牌谱文件
```

### 26.3 小程序线上要求

小程序线上请求需要使用 HTTPS / WSS，并在小程序管理后台配置合法服务器域名。  
因此生产环境至少需要：

```text
HTTPS 证书；
WSS 支持；
固定域名；
反向代理；
WebSocket upgrade 配置；
后端健康检查；
日志收集。
```

Nginx WebSocket 反向代理示例：

```nginx
location /ws {
    proxy_pass http://backend:3000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

---

## 27. 安全与隐私

### 27.1 不能记录敏感信息

日志中不要记录：

```text
微信 session_key；
完整 JWT；
用户敏感信息；
AppSecret；
数据库密码。
```

### 27.2 GameStep 可以保存训练数据

GameStep 可以保存：

```text
observation；
legal_actions；
action；
state hash；
模型版本；
结算 reward。
```

但如果面向真实用户，需要在隐私政策中说明对局数据会被用于模型改进。

### 27.3 后台接口保护

Admin API 必须单独鉴权：

```text
ADMIN_TOKEN；
或管理员用户角色；
不能普通用户访问训练数据导出接口。
```

---

## 28. 后续增强路线

第一版完成后，可以继续增强：

```text
1. 完整实现非标准麻将规则；
2. 增加匹配系统；
3. 支持好友房邀请；
4. 支持排行榜；
5. 支持多模型 A/B 测试；
6. 支持玩家托管；
7. 支持断线自动托管；
8. 支持完整回放播放器；
9. 支持后台模型版本管理；
10. 支持批量导出训练数据；
11. 支持规则版本灰度；
12. 支持多实例 WebSocket 横向扩展。
```

---

## 29. Codex 实现要求总结

请 Codex 基于本文档，在当前 `backend/` 文件夹中实现后端系统。

必须满足：

```text
1. 使用 Node.js + TypeScript；
2. 使用 Fastify 提供 HTTP API；
3. 使用 ws 提供原生 WebSocket；
4. 使用 Prisma + PostgreSQL 持久化；
5. 使用 Redis 管理实时房间状态和锁；
6. 实现 Auth / Room / Game / Rule / AI / WS / Replay 模块；
7. 规则引擎必须是纯逻辑模块；
8. 前端不能直接修改状态；
9. 所有动作必须由后端校验；
10. AI 返回动作必须二次校验；
11. 每一步动作必须保存 GameStep；
12. 所有玩家只能收到自己的 PlayerGameView；
13. 支持 mock login 和 mock rule engine；
14. 支持调用 AI 推理服务；
15. 支持 pytest/训练侧使用的 fixtures 导出；
16. 提供完整 Vitest 测试；
17. 提供 docker-compose 本地开发环境。
```

最终后端应支持：

```text
npm install
docker-compose up -d
npm run prisma:migrate
npm run dev
npm test
```

并能完成：

```text
mock login
→ 创建房间
→ 加入 AI
→ 开始游戏
→ WebSocket 订阅房间
→ 提交动作
→ AI 自动行动
→ 广播视角
→ 保存牌谱
→ 查询回放
```

---

## 30. 给 Codex 的一句话任务

请基于本文档，在 `backend/` 文件夹中搭建一个 TypeScript 后端：实现微信小程序麻将对局所需的认证、房间、规则、游戏状态、WebSocket、AI 调用、牌谱保存和测试闭环；第一版可以使用 MockRuleEngine 跑通完整流程，但所有接口必须为后续接入真实非标准麻将规则和训练侧 AI 模型预留清晰边界。

---

## 31. 参考依据

- 微信小程序线上网络请求需要使用 HTTPS / WSS，并校验证书和服务器域名。
- WebSocket 是长连接、全双工通道，适合实时游戏状态推送。
- 实时 WebSocket 服务横向扩展时通常需要共享状态或 pub/sub backplane，例如 Redis。
- 生产环境应实现 WebSocket 心跳、断线检测和重连恢复。
