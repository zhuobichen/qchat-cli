# 装 NapCat（OneBot 11 服务）

`qce` 不直接和 QQ 通信，它通过 **OneBot 11** 协议连 NapCat。所以第一次用需要先把 NapCat 跑起来，并且**用它登录你的 QQ 账号**（扫码）。

三种方式，任选一种。推荐 Docker（跨平台、可迁移、开机自启）。

---

## 方式一：Docker（推荐，Linux / Windows / macOS 通用）

```bash
docker run -d --name napcat --restart unless-stopped \
  -e NAPCAT_UID=1000 -e NAPCAT_GID=1000 \
  -e WEBUI_TOKEN=change-me-please \
  -p 127.0.0.1:3000:3000 \
  -p 127.0.0.1:6099:6099 \
  -v $HOME/napcat/config:/app/napcat/config \
  -v $HOME/napcat/qq:/app/.config/QQ \
  mlikiowa/napcat-docker:latest
```

- `3000` = OneBot HTTP/WS（`qce` 连这个）
- `6099` = WebUI（浏览器里看二维码、改配置）
- 两个端口都只绑 `127.0.0.1`，**不要**直接暴露公网
- 首次启动后用手机 QQ 扫码登录：

```bash
# 看容器日志里的二维码（ASCII 形式），或从 WebUI 打开
docker logs -f napcat
# 浏览器： http://127.0.0.1:6099/webui?token=change-me-please
```

登录成功后，容器里会生成 `config/onebot11_<QQ号>.json`。**默认是空配置（没有 HTTP 服务器）**，需要写成：

```json
{
  "network": {
    "httpServers": [{
      "name": "qchat-local",
      "enable": true,
      "host": "0.0.0.0",
      "port": 3000,
      "enableCors": false,
      "enableWebsocket": true,
      "messagePostFormat": "array",
      "token": "换成随机长串",
      "debug": false
    }],
    "httpSseServers": [], "httpClients": [],
    "websocketServers": [], "websocketClients": [], "plugins": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false,
  "imageDownloadProxy": "",
  "timeout": { "baseTimeout": 10000, "uploadSpeedKBps": 256, "downloadSpeedKBps": 256, "maxTimeout": 1800000 }
}
```

改完 `docker restart napcat`。注意 `host` 用 `0.0.0.0`（容器内监听全网卡），宿主侧仍然只绑 `127.0.0.1`，所以外部访问不到。

---

## 方式二：Windows 直接用 NapCat.Shell

1. 下载 [NapCat.Shell](https://github.com/NapNeko/NapCatQQ/releases) 并解压
2. 双击 `launcher-user.bat`，按提示启动 QQ 并扫码
3. 登录后到 `napcat/config/onebot11_<QQ号>.json` 按上面的 JSON 配好 `3000` 端口与 token
4. 重启 NapCat，浏览器打开 `http://127.0.0.1:6099/webui` 确认状态

> 同一 QQ 账号在本机客户端和 NapCat 之间是**互斥**的（单实例锁）。跑着 NapCat 时，客户端里登同一个号会互相挤；建议机器人用小号。

---

## 方式三：已有 OneBot 实现

只要对方实现了 OneBot 11 的 HTTP API（`get_login_info`、`get_group_list`、`send_msg` 等），就能直接接：

```bash
qce login --host 127.0.0.1 --port 3000
qce login --test
```

---

## 验证连通

```bash
# 无 token（不推荐，仅本地测试）
curl http://127.0.0.1:3000/get_login_info

# 有 token
curl -H "Authorization: Bearer <你的token>" http://127.0.0.1:3000/get_login_info
```

返回 `{"status":"ok","data":{"user_id":...,"nickname":"..."}}` 即成功。然后：

```bash
qce login --host 127.0.0.1 --port 3000
qce list groups
```

---

## 常见坑

| 现象 | 原因 | 解法 |
|---|---|---|
| `3000` 连不上，容器却 Up | 容器内只监听了 `127.0.0.1` | OneBot 配置 `host` 改 `0.0.0.0`，重启容器 |
| `get_login_info` 返回空 | 还没扫码登录 | WebUI / 日志里取二维码扫码 |
| 能读不能发，报 `w21 身份验证失败` | 登录态被 QQ 踢了（长时间空闲 / 异地 / 同号他处登录） | 重新扫码；机器人号不要同时在客户端登录 |
| 重启容器后要重新扫码 | 没启用快速登录 | 启动参数加 `-q <QQ号>`（部分版本支持） |
| 扫码后配置仍是空 `httpServers` | 新号首次登录只生成默认配置 | 按上文 JSON 手写 `onebot11_<QQ号>.json` |
