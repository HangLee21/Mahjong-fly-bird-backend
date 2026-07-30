# 前端接入后端本地配置

本文档给 Cocos Creator / 微信小游戏前端本地联调使用。

## 1. 后端本地启动

在 PowerShell 中执行：

```powershell
cd E:\Mahjong-fly-bird-backend\backend

Copy-Item .env.example .env
npm.cmd install

docker compose up -d

npm.cmd run prisma:generate
npm.cmd run prisma:migrate
npm.cmd run seed

npm.cmd run dev
```

健康检查：

```powershell
curl.exe http://localhost:3000/api/health
```

正常返回：

```json
{
  "ok": true
}
```

## 2. 前端配置

如果前端和后端运行在同一台电脑：

```ts
export const BackendConfig = {
  USE_MOCK_HTTP: false,
  USE_MOCK_WS: false,
  HTTP_BASE_URL: 'http://localhost:3000/api',
  WS_URL: 'ws://localhost:3000/ws'
};
```

如果用微信开发者工具或真机访问，需要把 `localhost` 改成后端电脑的局域网 IP：

```ts
export const BackendConfig = {
  USE_MOCK_HTTP: false,
  USE_MOCK_WS: false,
  HTTP_BASE_URL: 'http://192.168.x.x:3000/api',
  WS_URL: 'ws://192.168.x.x:3000/ws'
};
```

Windows 查看局域网 IP：

```powershell
ipconfig
```

使用 `IPv4 地址`，例如 `192.168.1.23`。

## 3. HTTP Header

登录以外的接口都带 token：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

## 4. Mock 微信登录

本地 `.env` 默认启用：

```env
WECHAT_MOCK_LOGIN=true
```

前端登录请求：

```http
POST /auth/wechat-login
Content-Type: application/json
```

```json
{
  "code": "<wx.login 返回的临时 code>",
  "nickname": "测试玩家",
  "avatarUrl": ""
}
```

体验版必须调用 `wx.login()` 获取一次性临时 code；不要在前端配置或传输
微信 AppSecret。后端通过 `jscode2session` 换取 openid 后签发自己的 JWT。
非法、过期或重复使用的 code 返回 HTTP `401`。

返回：

```json
{
  "token": "jwt_token",
  "user": {
    "id": "user_id",
    "nickname": "测试玩家",
    "avatarUrl": ""
  }
}
```

前端保存 `token`，后续请求放入 `Authorization`。

## 5. Boot 接入流程

```text
GET /app/bootstrap
如果本地有 token -> GET /auth/session
valid=true -> 进入 Lobby
valid=false -> 清除 token，进入 Login
```

接口：

```http
GET /app/bootstrap
GET /auth/session
POST /auth/wechat-login
```

## 6. Lobby 接入

```http
GET /lobby/summary
Authorization: Bearer <token>
```

返回里重点字段：

```json
{
  "user": {},
  "notice": "欢迎体验曲靖飞小鸡",
  "activeRoom": null,
  "recentRooms": []
}
```

如果 `activeRoom` 不为空，前端可以显示继续房间入口。

## 7. 房间接入

创建房间：

```http
POST /rooms
Authorization: Bearer <token>
Content-Type: application/json
```

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

加入房间：

```http
POST /rooms/{roomId}/join
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "seatIndex": 1
}
```

预检查房间号：

```http
GET /rooms/{roomId}/preview
Authorization: Bearer <token>
```

添加 AI：房间内任意真实玩家都可以调用。

```http
POST /rooms/{roomId}/add-ai
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "seatIndex": 2,
  "model": "heuristic_mock"
}
```

`seatIndex` 可以不传；也可以传数字或数字字符串。连续添加多个 AI 时，如果前端重复传了同一个座位，后端会自动放到下一个空位。

开始游戏：房间内任意真实玩家都可以调用，房间必须已经坐满 4 个座位。

```http
POST /rooms/{roomId}/start
Authorization: Bearer <token>
```

## 8. 游戏接入

获取当前玩家视角：

```http
GET /games/{gameId}/view
Authorization: Bearer <token>
```

提交动作：

```http
POST /games/{gameId}/actions
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "type": "DISCARD",
  "tile": 18,
  "actionId": 18,
  "clientSeq": 1,
  "extra": {}
}
```

前端按钮不要自行判断吃碰杠胡，只根据 `legalActions` 显示。

当前后端已经启用 `QujingFeiXiaoJiRuleEngine`，可以完成一局基础飞小鸡麻将的真实流程：

- 摸牌、出牌
- 点炮胡、自摸胡、一炮多响
- 吃、碰、明杠、暗杠、加杠
- 小鸡作为万能牌参与胡牌和杠牌
- 小鸡不能作为万能牌参与吃碰
- 公开杠牌补牌
- 流局和基础分数结算

前端仍然只需要消费 `legalActions`，不要在 UI 层重复实现规则。

## 9. WebSocket

连接地址：

```text
ws://localhost:3000/ws?token=<token>
```

局域网真机：

```text
ws://192.168.x.x:3000/ws?token=<token>
```

订阅房间：

```json
{
  "type": "ROOM_SUBSCRIBE",
  "roomId": "886688",
  "ts": 1710000000000
}
```

进入等待房间后就应发送 `ROOM_SUBSCRIBE`，不要等到牌局开始。正常退出房间时先发送：

```json
{
  "type": "ROOM_LEAVE",
  "roomId": "886688",
  "requestId": "leave_001"
}
```

也可以调用 `POST /api/rooms/{roomId}/leave`。最后一名真实玩家退出后响应包含 `deleted: true`，房间号随即释放。异常断线超过默认 60 秒未重连时，后端也会自动退出并销毁空房间。

提交游戏动作：

```json
{
  "type": "GAME_ACTION",
  "roomId": "886688",
  "gameId": "game_id",
  "payload": {
    "type": "DISCARD",
    "tile": 18,
    "actionId": 18,
    "clientSeq": 1
  },
  "ts": 1710000000000
}
```

心跳：

```json
{
  "type": "PING",
  "ts": 1710000000000
}
```

## 10. 最小联调顺序

```text
1. POST /auth/wechat-login，保存 token
2. GET /app/bootstrap
3. GET /auth/session
4. GET /lobby/summary
5. POST /rooms 创建房间
6. POST /rooms/{roomId}/add-ai 调 3 次
7. POST /rooms/{roomId}/start
8. 连接 ws://<host>/ws?token=<token>
9. 发送 ROOM_SUBSCRIBE
10. 根据 GAME_VIEW.legalActions 提交 GAME_ACTION
```

## 10.1 Stable-Baselines3 AI 模型接入

模型文件位置：

```text
E:\Mahjong-fly-bird-backend\model\v3-lite.zip
```

启动 AI 推理服务：

```powershell
cd E:\Mahjong-fly-bird-backend
py -m venv .venv-ai
.\.venv-ai\Scripts\Activate.ps1
pip install -r ai_service\requirements.txt
$env:SB3_MODEL_PATH = "E:\Mahjong-fly-bird-backend\model\v3-lite.zip"
$env:SB3_ALGO = "PPO"
uvicorn ai_service.sb3_server:app --host 0.0.0.0 --port 8001
```

如果模型不是 PPO 训练的，把 `SB3_ALGO` 改成 `DQN` 或 `A2C`。

检查 AI 服务：

```powershell
curl.exe http://localhost:8001/health
```

后端 `.env` 保持：

```env
AI_SERVICE_URL=http://localhost:8001
```

添加 AI 座位时传模型名：

```http
POST /rooms/{roomId}/add-ai
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "seatIndex": 1,
  "model": "v3-lite"
}
```

后端会在 AI 行动时调用：

```text
POST http://localhost:8001/ai/act
```

并传入当前玩家 observation、合法动作 `legal_actions` 和 `model_version=v3-lite`。后端仍会校验模型返回动作是否合法；如果模型服务不可用或返回非法动作，会走 fallback，不会卡死牌局。

## 11. 常见问题

清理测试房间号：

```powershell
$headers = @{ Authorization = "Bearer <backend/.env 里的 ADMIN_TOKEN>" }
Invoke-RestMethod -Method Delete -Uri "http://localhost:3000/api/admin/rooms/123456" -Headers $headers
```

批量清理等待中的测试房间：

```powershell
$headers = @{ Authorization = "Bearer <backend/.env 里的 ADMIN_TOKEN>" }
$body = @{ status = "WAITING"; olderThanMinutes = 0 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/admin/rooms/cleanup" -Headers $headers -ContentType "application/json" -Body $body
```

如果微信开发者工具或真机访问失败：

- 不要使用 `localhost`，改用后端电脑局域网 IP。
- 确认后端服务监听中：`curl.exe http://localhost:3000/api/health`。
- 确认 Docker 中 PostgreSQL 和 Redis 已启动：`docker compose ps`。
- 确认 Windows 防火墙允许 Node.js 或 3000 端口访问。
- 微信开发者工具本地调试时可勾选“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。
