# Docker 服务器部署

这套部署会长期运行五个容器：

- `caddy`：唯一公网入口，自动申请和续期 HTTPS 证书，同时代理 WebSocket。
- `backend`：Fastify HTTP API 与 `/ws` WebSocket。
- `ai`：加载 `model/v3-lite.zip` 的 Stable-Baselines3 推理服务。
- `postgres`：持久化用户、房间、牌局与回放。
- `redis`：持久化实时房间状态与分布式锁。

PostgreSQL、Redis、Node 后端和 AI 服务均不映射到宿主机公网端口。服务器只需要开放 `22/tcp`、`80/tcp`、`443/tcp` 和 `443/udp`。

## 1. 服务器准备

建议使用 Ubuntu 22.04/24.04、至少 4 核 CPU、8 GB 内存和 30 GB 可用磁盘。CPU 推理不需要显卡；使用 GPU 时还需要 NVIDIA 驱动与 Container Toolkit。

安装 Docker Engine 与 Compose v2 后确认：

```bash
docker --version
docker compose version
```

将域名（例如 `api.example.com`）的 DNS `A` 记录指向服务器公网 IP，并确保云安全组及系统防火墙允许 `80/443`。Caddy 需要这两个端口来申请证书。

## 2. 上传项目

把项目放到服务器，例如：

```bash
cd /opt
git clone <你的仓库地址> mahjong-fly-bird-backend
cd mahjong-fly-bird-backend
```

模型 ZIP 默认被 `.gitignore` 排除，需要单独上传：

```text
/opt/mahjong-fly-bird-backend/model/v3-lite.zip
```

同时确认模型配置存在：

```text
/opt/mahjong-fly-bird-backend/model/config/ppo_v3_lite_action_value_bc_finetune.yaml
```

## 3. 配置生产环境

首次执行会生成 `.env.server` 并停止：

```bash
chmod +x deploy-server.sh
./deploy-server.sh
```

编辑配置：

```bash
nano .env.server
```

至少修改 `SERVER_DOMAIN`、数据库/Redis 密码、`JWT_SECRET`、`ADMIN_TOKEN`、`WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。密码使用足够长的随机字母数字组合，不要保留示例值。

体验版微信登录配置：

```dotenv
SERVER_DOMAIN=你的真实API域名
WECHAT_APP_ID=在服务器填写真实微信小游戏AppID
WECHAT_APP_SECRET=仅在服务器填写真实AppSecret
WECHAT_MOCK_LOGIN=false
WECHAT_API_TIMEOUT_MS=5000
```

`.env.server` 已被 Git 忽略。不要把真实 `WECHAT_APP_SECRET` 写入
Dockerfile、前端工程、提交记录或部署日志。

生成随机值可使用：

```bash
openssl rand -hex 32
```

## 4. 构建并启动

```bash
./deploy-server.sh
```

首次构建 AI 镜像需要下载 CPU 版 PyTorch，耗时和镜像体积会比较大。完成后检查：

```bash
docker compose --env-file .env.server -f docker-compose.server.yml ps
curl https://你的域名/api/health
```

正常响应：

```json
{"ok":true}
```

## 5. 前端接入

微信小游戏不再连接 `localhost`，统一改为：

```text
HTTP API: https://你的域名/api
WebSocket: wss://你的域名/ws?token=<JWT>
远程资源: https://你的域名/game-assets/remote/resources/
```

在微信公众平台把该域名加入 `request`、`socket` 和 `downloadFile`
合法域名。生产环境必须使用平台认可的 HTTPS 证书；Caddy 会自动续期。

前端完成 Cocos 微信小游戏构建后，将整个 `build/wechatgame/remote`
目录上传到服务器的：

```text
/opt/mahjong-fly-bird-backend/game-assets/remote
```

Caddy 会将 `/game-assets/*` 映射到该目录。不要只上传某个 `native`
子目录，否则远程 Bundle 的配置清单会缺失。

用本次构建实际生成的配置文件名检查静态资源，不要只请求目录：

```bash
curl -I https://你的域名/game-assets/remote/resources/config.<本次Hash>.json
```

前端不连接 Redis、PostgreSQL 或 AI 的 `8001` 端口。

## 6. 日常运维

查看状态与日志：

```bash
docker compose --env-file .env.server -f docker-compose.server.yml ps
docker compose --env-file .env.server -f docker-compose.server.yml logs -f backend ai
```

更新代码并滚动重建：

```bash
git pull
./deploy-server.sh
```

重启或停止：

```bash
docker compose --env-file .env.server -f docker-compose.server.yml restart
docker compose --env-file .env.server -f docker-compose.server.yml down
```

`down` 不会删除数据库、Redis 和证书卷。不要执行 `down -v`，除非明确要永久删除全部持久化数据。

验证 AI 确实加载了模型：

```bash
docker compose --env-file .env.server -f docker-compose.server.yml exec ai \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8001/health').read().decode())"
```

返回内容应包含 `model_path`、`observation_dim_from_config` 和 `observation_space`。

备份 PostgreSQL：

```bash
mkdir -p backups
docker compose --env-file .env.server -f docker-compose.server.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | \
  gzip > "backups/mahjong-$(date +%F-%H%M%S).sql.gz"
```

服务器防火墙不要开放 `3000`、`8001`、`5432`、`6379`。Redis 已启用密码、protected mode、AOF，并且只位于 Docker 内部网络。
