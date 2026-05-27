# Mahjong Fly Bird Backend

基于 TypeScript 的麻将小程序后端。当前第一版使用 `MockRuleEngine` 跑通完整闭环：mock 登录、创建房间、添加 AI、开始游戏、WebSocket 推送个人视角、提交动作、AI fallback 行动、牌谱保存与查询。

后端代码在 [`backend/`](backend/README.md)。

## 环境要求

- Node.js 20+，当前已验证 `v24.15.0`
- npm
- Docker Desktop 或本机 PostgreSQL + Redis

如果 PowerShell 找不到 `node`/`npm`，先刷新 PATH：

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

如果 PowerShell 阻止 `npm.ps1`，使用 `npm.cmd`：

```powershell
npm.cmd -v
```

## 本地启动

进入后端目录：

```powershell
cd backend
```

安装依赖：

```powershell
npm.cmd install
```

创建环境变量文件：

```powershell
Copy-Item .env.example .env
```

启动 PostgreSQL 和 Redis：

```powershell
docker compose up -d
```

生成 Prisma Client：

```powershell
npm.cmd run prisma:generate
```

初始化数据库：

```powershell
npm.cmd run prisma:migrate
```

写入默认模型版本数据：

```powershell
npm.cmd run seed
```

启动开发服务：

```powershell
npm.cmd run dev
```

默认服务地址：

```text
HTTP: http://localhost:3000
WebSocket: ws://localhost:3000/ws?token=<jwt>
```

## 验证

健康检查：

```powershell
curl http://localhost:3000/api/health
```

运行测试：

```powershell
npm.cmd test
```

构建检查：

```powershell
npm.cmd run build
```

## 最小联调流程

1. `POST /api/auth/wechat-login`，body: `{ "code": "dev_user" }`
2. 使用返回的 `token` 创建房间：`POST /api/rooms`
3. 调用三次 `POST /api/rooms/:roomId/add-ai`
4. 调用 `POST /api/rooms/:roomId/start`
5. 连接 `ws://localhost:3000/ws?token=<token>`
6. 发送 `ROOM_SUBSCRIBE`
7. 从 `GAME_VIEW` 里取合法出牌动作，发送 `GAME_ACTION`
8. 调用 `GET /api/replays/:gameId` 查询牌谱

更多接口说明见 [`backend/docs/api.md`](backend/docs/api.md)，WebSocket 协议见 [`backend/docs/websocket_protocol.md`](backend/docs/websocket_protocol.md)。
