# 微信小游戏远程资源

此目录由 Caddy 通过以下地址提供静态资源：

```text
https://<SERVER_DOMAIN>/game-assets/
```

前端完成微信小游戏构建后，将
`game-client/build/wechatgame/remote` 整个目录同步到这里，最终结构应为：

```text
game-assets/
  remote/
    resources/
      config.*.json
      import/
      native/
```

前端 Cocos 构建面板中的“资源服务器地址”应填写：

```text
https://<SERVER_DOMAIN>/game-assets/
```

不要只复制 `resources` 子目录。Cocos 会自动在资源服务器地址后拼接
`remote/resources`。

启用 MD5 Cache 后，`config`、`import` 和 `native` 文件名都带内容 Hash。
Caddy 因此对该目录使用长期不可变缓存。每次更新请合并上传整个 `remote`
目录并保留旧 Hash 文件，避免仍在运行的旧体验版短时间内请求失败。

本项目的本地同步路径：

```text
源目录: E:\Mahjong-fly-bird-frontend\game-client\build\wechatgame\remote
目标目录: E:\Mahjong-fly-bird-backend\game-assets\remote
```

服务器更新时使用合并复制，不要添加 `--delete`：

```bash
rsync -a ./new-build/remote/ ./game-assets/remote/
```

上传后至少核对文件数量、相对路径和文件大小，并确认
`remote/resources/config.<hash>.json`、`import/`、`native/` 同时存在。
