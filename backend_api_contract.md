# Backend API Contract

本文档给 Cocos Creator / 微信小游戏前端接入后端使用。后端 REST 基础地址：

```text
http://<host>:3000/api
```

WebSocket 地址：

```text
ws://<host>:3000/ws?token=<jwt>
```

本地开发：

```text
HTTP: http://localhost:3000/api
WS:   ws://localhost:3000/ws?token=<jwt>
```

真机联调时把 `localhost` 换成后端电脑的局域网 IP。

## 1. 通用约定

登录外的 HTTP 请求都带：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

错误响应：

```json
{
  "code": "ROOM_NOT_FOUND",
  "message": "Room not found.",
  "details": {}
}
```

## 2. 通用类型

### User

```json
{
  "id": "u_001",
  "nickname": "微信昵称",
  "avatarUrl": "https://..."
}
```

### TileId

后端使用 `0-33` 表示 34 种牌面：

```text
0-8    万 1-9
9-17   筒 1-9
18-26  条 1-9
27-33  字牌：东、南、西、北、中、发、白
```

`18` 是 `1条`，也就是飞小鸡规则里的小鸡牌。

### ActionType

```text
DISCARD
PASS
WIN
PONG
CHOW_LEFT
CHOW_MIDDLE
CHOW_RIGHT
KONG_EXPOSED
KONG_CONCEALED
KONG_ADDED
SELECT_KONG_TILE
```

ActionId 映射：

```text
0-33  DISCARD tile id
100   PASS
101   WIN
102   PONG
103   CHOW_LEFT
104   CHOW_MIDDLE
105   CHOW_RIGHT
106   KONG_EXPOSED
107   KONG_CONCEALED
108   KONG_ADDED
109   SELECT_KONG_TILE
```

前端不要自行判断吃碰杠胡，只根据后端返回的 `legalActions` 显示按钮。

## 3. App / Boot

### GET `/app/bootstrap`

启动配置接口。Boot 页进入 Lobby 前调用。

响应：

```json
{
  "serverTime": 1710000000000,
  "maintenance": false,
  "minClientVersion": "0.1.0",
  "rulePreset": "qujing-fei-xiaoji-v1.5",
  "assetVersion": "2026.05.28",
  "wsUrl": "ws://localhost:3000/ws",
  "notice": "欢迎体验曲靖飞小鸡"
}
```

推荐启动流程：

```text
GET /app/bootstrap
如果本地有 token -> GET /auth/session
valid=true -> Lobby
valid=false -> Login
```

## 4. Auth

### POST `/auth/wechat-login`

本地开发默认 `WECHAT_MOCK_LOGIN=true`，`code` 会映射为 `openid=mock_<code>`。

请求：

```json
{
  "code": "dev_user",
  "nickname": "测试玩家",
  "avatarUrl": ""
}
```

响应：

```json
{
  "token": "jwt_token",
  "user": {
    "id": "u_001",
    "nickname": "测试玩家",
    "avatarUrl": ""
  }
}
```

### GET `/auth/session`

校验本地 token 是否有效。

请求：

```http
GET /auth/session
Authorization: Bearer <token>
```

有效：

```json
{
  "valid": true,
  "user": {
    "id": "u_001",
    "nickname": "测试玩家",
    "avatarUrl": ""
  }
}
```

无效：

```json
{
  "valid": false,
  "user": null
}
```

### POST `/auth/refresh`

刷新 token。

### GET `/auth/me`

获取当前用户。

## 5. Lobby

### GET `/lobby/summary`

获取大厅摘要。

请求：

```http
GET /lobby/summary
Authorization: Bearer <token>
```

响应：

```json
{
  "user": {
    "id": "u_001",
    "nickname": "测试玩家",
    "avatarUrl": ""
  },
  "notice": "欢迎体验曲靖飞小鸡",
  "activeRoom": {
    "roomId": "886688",
    "status": "PLAYING",
    "gameId": "game_001"
  },
  "recentRooms": [
    {
      "roomId": "886688",
      "gameId": "game_001",
      "finishedAt": 1710000000000,
      "title": "曲靖飞小鸡 886688"
    }
  ]
}
```

`activeRoom` 可能为 `null`。不为空时前端可以展示“继续房间”入口。

## 6. Room

房间接口里的 `roomId` 同时支持：

- 后端内部数据库 id
- 6 位房间号 `roomCode`

前端展示和输入优先使用 6 位房间号。

### RoomView

```json
{
  "roomId": "886688",
  "internalRoomId": "clx...",
  "ownerId": "u_001",
  "status": "WAITING",
  "gameId": null,
  "rules": {
    "preset": "qujing-fei-xiaoji-v1.5",
    "roundCount": 16,
    "allowChow": true,
    "fanCap": 3,
    "publicKongTiles": 2,
    "xiaoJiTile": "1-tiao",
    "drawMode": "fixed-wall-reserve",
    "allowMultiWin": true
  },
  "seats": [
    {
      "seatIndex": 0,
      "user": {
        "id": "u_001",
        "nickname": "测试玩家",
        "avatarUrl": ""
      },
      "isAI": false,
      "isReady": true,
      "isOwner": true
    },
    {
      "seatIndex": 1,
      "isAI": false,
      "isReady": false,
      "isOwner": false
    }
  ]
}
```

`status`：

```text
WAITING | PLAYING | FINISHED
```

### POST `/rooms`

创建房间。前端可传入 6 位 `roomId` 作为房间号；后端会把它保存为 `roomCode` 并原样返回。创建者自动坐到 0 号位。

请求：

```json
{
  "roomId": "886688",
  "rules": {
    "preset": "qujing-fei-xiaoji-v1.5",
    "roundCount": 16,
    "allowChow": true,
    "fanCap": 3,
    "publicKongTiles": 2,
    "xiaoJiTile": "1-tiao",
    "drawMode": "fixed-wall-reserve",
    "allowMultiWin": true
  }
}
```

响应：

```json
{
  "room": {}
}
```

### GET `/rooms/{roomId}`

获取房间详情。

### GET `/rooms/{roomId}/preview`

房间号预检查。RoomEntry 输入 6 位房间号后可调用。

房间存在：

```json
{
  "exists": true,
  "roomId": "886688",
  "status": "WAITING",
  "seatCount": 2,
  "maxSeats": 4,
  "canJoin": true,
  "ownerNickname": "房主昵称",
  "rules": {}
}
```

房间不存在：

```json
{
  "exists": false,
  "roomId": "886688",
  "canJoin": false,
  "message": "Room not found."
}
```

### POST `/rooms/{roomId}/join`

加入房间。

请求：

```json
{
  "seatIndex": 1
}
```

`seatIndex` 可选。不传则后端分配第一个空位。

响应：`RoomView`

### POST `/rooms/{roomId}/leave`

退出房间。若还有其他真实玩家，响应为更新后的 `RoomView`，房主退出时房主身份自动转移给下一名真实玩家。

AI 座位不计为真实玩家。最后一名真实玩家退出后，后端会原子删除房间、座位、关联牌局和 Redis 实时状态，房间号可以再次创建。此时响应：

```json
{
  "deleted": true,
  "roomId": "886688",
  "internalRoomId": "internal_room_id"
}
```

### POST `/rooms/{roomId}/add-ai`

添加 AI。当前本地联调版本已放开权限：房间内任意真实玩家都可以添加 AI。

请求：

```json
{
  "seatIndex": 2,
  "model": "v3-lite"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `seatIndex` | number/string | 否 | 指定座位；不传则自动找空位；如果指定座位已占用，后端会自动改用下一个空位 |
| `model` | string | 否 | AI 模型名。使用 Stable-Baselines3 模型时传 `v3-lite` |

响应：`RoomView`

### POST `/rooms/{roomId}/start`

开始游戏。当前本地联调版本已放开权限：房间内任意真实玩家都可以开始游戏；房间必须 4 个座位都已占用。

响应：

```json
{
  "roomId": "internal_room_id",
  "gameId": "game_001",
  "status": "PLAYING",
  "self": {},
  "legalActions": []
}
```

当前实现直接返回调用者玩家视角的 `PlayerGameView`。

## 7. Game

### PlayerGameView

这是当前登录玩家视角的牌局数据。其他玩家手牌不会暴露。

```json
{
  "roomId": "internal_room_id",
  "gameId": "game_001",
  "ruleVersion": "qujing-fei-xiaoji-v1.5",
  "status": "PLAYING",
  "currentPlayer": 0,
  "dealer": 0,
  "roundIndex": 0,
  "stepIndex": 18,
  "scores": [0, 0, 0, 0],
  "totalScores": [0, 0, 0, 0],
  "currentRound": 1,
  "maxRounds": 1,
  "isFinalRound": true,
  "wallCount": 72,
  "wallTilesRemaining": 72,
  "publicKongTiles": [13, 31],
  "xiaoJiActiveAsWild": true,
  "self": {
    "seatIndex": 0,
    "userId": "u_001",
    "isAI": false,
    "handCount": 14,
    "hand": [0, 1, 2, 4, 4, 7, 9, 12, 18, 18, 24, 27, 31, 31],
    "melds": [],
    "discards": [],
    "status": "ACTIVE",
    "legalActions": []
  },
  "players": [
    {
      "seatIndex": 1,
      "userId": null,
      "isAI": true,
      "handCount": 13,
      "melds": [],
      "discards": [],
      "status": "ACTIVE"
    }
  ],
  "opponents": [],
  "lastDiscard": {
    "tile": 21,
    "fromPlayer": 3,
    "stepIndex": 17
  },
  "legalActions": [
    {
      "type": "DISCARD",
      "tile": 0,
      "actionId": 0
    },
    {
      "type": "WIN",
      "actionId": 101
    }
  ],
  "result": null,
  "updatedAt": 1710000000000
}
```

`status`：

```text
INIT | PLAYING | WAITING_RESPONSE | FINISHED
```

说明：

- `self.hand` 只返回当前玩家手牌。
- `players/opponents` 只返回其他玩家 `handCount`。
- 前端操作按钮直接使用顶层 `legalActions` 或 `self.legalActions`。
- `WAITING_RESPONSE` 时，可能是其他玩家打牌后当前玩家可以胡/碰/杠/吃/过。

### GET `/games/{gameId}/view`

获取当前玩家视角牌局。

### POST `/games/{gameId}/actions`

提交动作。REST 可作为 WebSocket 兜底或调试接口。

请求：

```json
{
  "type": "DISCARD",
  "tile": 18,
  "actionId": 18,
  "clientSeq": 18,
  "extra": {}
}
```

响应：

```json
{
  "accepted": true,
  "view": {}
}
```

### 兼容旧接口

以下接口仍可用：

```text
GET  /rooms/{roomId}/game
POST /rooms/{roomId}/game/actions
```

## 8. ScoreResult

牌局结束后，`PlayerGameView.result` 包含结算结果：

```json
{
  "winnerIndexes": [0],
  "loserIndexes": [1, 2, 3],
  "dealer": 0,
  "isSelfDraw": true,
  "isDraw": false,
  "baseScore": 1,
  "cappedFan": 1,
  "fanItems": [
    {
      "code": "BASIC_WIN",
      "name": "自摸胡牌",
      "fan": 1,
      "points": 2
    }
  ],
  "scoreDelta": [6, -2, -2, -2],
  "scores": [6, -2, -2, -2],
  "title": "自摸胡牌",
  "description": "基础飞小鸡规则结算。"
}
```

流局：

```json
{
  "isDraw": true,
  "winnerIndexes": [],
  "loserIndexes": [],
  "scoreDelta": [0, 0, 0, 0],
  "title": "流局"
}
```

## 9. Replay

### GET `/replays`

获取当前用户回放列表。

响应：

```json
[
  {
    "gameId": "game_001",
    "roomId": "886688",
    "title": "曲靖飞小鸡 886688"
  }
]
```

### GET `/replays/{gameId}`

获取单局回放。

响应：

```json
{
  "roomId": "886688",
  "gameId": "game_001",
  "title": "曲靖飞小鸡 886688",
  "steps": [
    {
      "stepIndex": 18,
      "view": {},
      "events": []
    }
  ]
}
```

## 10. WebSocket

连接：

```text
ws://<host>:3000/ws?token=<jwt>
```

### 心跳

客户端：

```json
{
  "type": "PING",
  "requestId": "optional"
}
```

服务端：

```json
{
  "type": "PONG",
  "requestId": "optional"
}
```

### 订阅房间

客户端：

```json
{
  "type": "ROOM_SUBSCRIBE",
  "roomId": "886688",
  "requestId": "req_001"
}
```

服务端：

```json
{
  "type": "ACK",
  "requestId": "req_001",
  "payload": {
    "roomId": "886688"
  }
}
```

如果牌局已开始，服务端会随后推送当前玩家的 `GAME_VIEW`。

### 退出房间

场景正常退出时，推荐在关闭 WebSocket 前显式发送：

```json
{
  "type": "ROOM_LEAVE",
  "roomId": "886688",
  "requestId": "req_leave_001"
}
```

服务端返回 `ACK`，`payload` 与 `POST /rooms/{roomId}/leave` 的响应一致。客户端进入房间后应立即发送 `ROOM_SUBSCRIBE`，包括尚未开始游戏的等待房间。

若客户端异常断线且没有发送 `ROOM_LEAVE`，在 `ROOM_DISCONNECT_GRACE_MS` 宽限期内未重连时，后端会自动执行退出。最后一名真实玩家被移除后房间自动销毁；默认宽限期为 60 秒。

### 提交动作

推荐格式：

```json
{
  "type": "GAME_ACTION",
  "roomId": "886688",
  "gameId": "game_001",
  "payload": {
    "type": "DISCARD",
    "tile": 18,
    "actionId": 18,
    "clientSeq": 18
  },
  "requestId": "req_002"
}
```

兼容格式：

```json
{
  "type": "GAME_ACTION",
  "roomId": "886688",
  "action": {
    "type": "DISCARD",
    "tile": 18,
    "actionId": 18
  }
}
```

服务端 ACK：

```json
{
  "type": "ACK",
  "requestId": "req_002",
  "payload": {}
}
```

### 服务端推送 GAME_VIEW

```json
{
  "type": "GAME_VIEW",
  "roomId": "internal_room_id",
  "payload": {}
}
```

`payload` 是当前连接用户自己的 `PlayerGameView`。

### 服务端推送 GAME_EVENT

```json
{
  "type": "GAME_EVENT",
  "roomId": "internal_room_id",
  "payload": {
    "gameId": "game_001",
    "stepIndex": 19,
    "status": "PLAYING"
  }
}
```

### 错误推送

```json
{
  "type": "ERROR",
  "code": "ILLEGAL_ACTION",
  "message": "Action is not legal in current state.",
  "details": {}
}
```

## 11. 当前已实现的飞小鸡规则范围

后端当前启用 `QujingFeiXiaoJiRuleEngine`，支持完成一局基础飞小鸡麻将：

- 4 人牌局
- 136 张牌
- 初始发牌
- 两张公开杠牌
- 摸牌 / 出牌
- 点炮胡 / 自摸胡 / 一炮多响
- 吃 / 碰 / 明杠 / 暗杠 / 加杠
- 响应优先级：胡 > 杠 > 碰 > 吃
- 小鸡作为万能牌参与胡牌和杠牌
- 小鸡不能作为万能牌参与吃 / 碰
- 牌墙阈值流局
- 基础分数结算

暂未完全裁判化的边缘规则：

- 手动选择公开杠牌
- 抢杠
- 同巡振听
- 小鸡拒和振听
- 拒碰限制
- 四风连打
- 包牌
- 诈和 / 相公处理
- 多局庄家轮转和连续流局翻倍

这些不会影响前端完成基础正常对局联调。

## 12. Stable-Baselines3 AI 接入

模型文件：

```text
model/v3-lite.zip
```

启动 AI 服务：

```powershell
cd E:\Mahjong-fly-bird-backend
py -m venv .venv-ai
.\.venv-ai\Scripts\Activate.ps1
pip install -r ai_service\requirements.txt
$env:SB3_MODEL_PATH = "E:\Mahjong-fly-bird-backend\model\v3-lite.zip"
$env:SB3_ALGO = "PPO"
uvicorn ai_service.sb3_server:app --host 0.0.0.0 --port 8001
```

后端 `.env`：

```env
AI_SERVICE_URL=http://localhost:8001
```

添加 AI：

```json
{
  "seatIndex": 1,
  "model": "v3-lite"
}
```

后端会把 `model` 作为 `model_version` 发送给 AI 服务。AI 服务返回 action id，后端再次校验合法性；如果模型不可用或返回非法动作，会使用 fallback 策略，避免牌局卡死。

## 13. 前端最小联调流程

```text
1. GET /app/bootstrap
2. POST /auth/wechat-login，保存 token
3. GET /auth/session
4. GET /lobby/summary
5. POST /rooms 创建房间
6. POST /rooms/{roomId}/add-ai 添加 3 个 AI
7. POST /rooms/{roomId}/start
8. 连接 ws://<host>:3000/ws?token=<token>
9. 发送 ROOM_SUBSCRIBE
10. 收 GAME_VIEW
11. 根据 legalActions 显示操作按钮
12. 发送 GAME_ACTION
13. 持续消费 GAME_VIEW / GAME_EVENT
```

## 14. 本地测试房间清理

测试时如果固定房间号已经创建过，会因为 `roomCode` 唯一约束无法再次创建。后端已提供 admin 清理接口。

请求头：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

`ADMIN_TOKEN` 来自 `backend/.env`。

删除单个房间：

```http
DELETE /api/admin/rooms/{roomId}
```

响应：

```json
{
  "deleted": true,
  "roomId": "123456",
  "internalRoomId": "internal_room_id"
}
```

批量清理等待中的测试房间：

```http
POST /api/admin/rooms/cleanup
Content-Type: application/json
```

```json
{
  "status": "WAITING",
  "olderThanMinutes": 0
}
```

`status` 支持 `WAITING`、`FINISHED`、`PLAYING`。本地联调优先清理 `WAITING`；不要随便批量清理 `PLAYING`，除非确认这些都是测试牌局。
