# 本地 Beta 测试环境（Apple Container）

## 为什么需要两套容器配置？

| | 生产部署（DO） | 本地 Beta 测试（macOS） |
|---|---|---|
| 工具 | Docker Compose | Apple Container（`container` CLI） |
| 镜像 | 自建（`docker build`） | 官方 `node:20-slim` |
| `node_modules` | 在镜像内 `npm ci` | 挂载本地目录，容器内重新 `npm install` |
| 端口 | 80/443（Caddy 代理） | 3000（直接访问） |
| SQLite 数据 | `/opt/claimflow/data` | `wa-bot/data/`（挂载） |
| Chromium/Puppeteer | 镜像内安装（`apt-get`） | ❌ 暂不启用（Bot 功能不需要 beta 测试） |

**核心差异**：生产环境用多阶段 `Dockerfile` 构建含 Chromium 的镜像；本地 beta 测试只需要能跑 Express Admin 后台，不需要 Chromium，也不需要 Caddy。

---

## 快速启动

```bash
bash scripts/beta-local.sh
```

首次运行会自动：
1. 检查 Apple Container 是否已安装（`brew install container`）
2. 备份 macOS 原生 `node_modules` → `node_modules.mac`
3. 拉取 `docker.io/library/node:20-slim` 镜像（约 200MB）
4. 在容器内 `npm install`（编译 Linux 版本的原生模块）
5. 等待 `localhost:3000` 返回 HTTP 状态码，然后打印访问地址

**首次访问**：`<a href="http://localhost:3000/admin/setup">http://localhost:3000/admin/setup</a>` 创建 admin 账号。

---

## 常见错误与解决方案

### 1. `Error: /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node: invalid ELF header`

**原因**：`node_modules/` 里 `better-sqlite3` 的 `.node` 文件是 macOS Mach-O 格式，容器是 Linux。

**解决**：脚本会自动把 `node_modules` 重命名为 `node_modules.mac`，让容器内重新 `npm install` 生成 Linux 版本。

如果手动处理：
```bash
mv wa-bot/node_modules wa-bot/node_modules.mac
bash scripts/beta-local.sh
```

### 2. `bind: Address already in use`（端口 3000 被占用）

**原因**：有另一个 Node 进程在跑 3000 端口。

**解决**：
```bash
lsof -i :3000 | grep LISTEN   # 找到 PID
kill -9 <PID>                      # 杀掉
bash scripts/beta-local.sh
```

### 3. Puppeteer/Chromium 启动失败（不影响 beta 测试）

**现象**：容器日志显示 `Failed to launch the browser process`，但 `管理后台已启动，监听端口 3000`。

**原因**：本地 beta 测试没安装 Chromium（`node:20-slim` 镜像不含 Chromium 依赖）。

**影响范围**：仅影响 AI 自动识别收据金额功能；Admin 后台、feedback 页面完全正常。

**如果确实需要 Puppeteer**：改用完整 `node:20` 镜像（约 1GB+），并在 `container run` 时加 `--cap-add=SYS_PTRACE` 等参数。

### 4. 修改代码后如何重启？

```bash
bash scripts/beta-local.sh --stop   # 停容器
bash scripts/beta-local.sh             # 重新启动（代码是挂载的，修改即时生效）
```

> ⚠️ 如果修改了 `package.json`，需要删掉容器内的 `node_modules` 重新安装。最干净的方式：
> ```bash
> bash scripts/beta-local.sh --clean   # 停容器 + 删 node_modules
> bash scripts/beta-local.sh                  # 重新安装依赖 + 启动
> ```

---

## 与生产部署的切换

| 操作 | 生产（DO） | 本地 Beta |
|---|---|---|
| 启动 | `ssh root@<DROPLET_IP>` → `cd /opt/claimflow && docker compose up -d` | `bash scripts/beta-local.sh` |
| 查看日志 | `docker compose logs -f` | `bash scripts/beta-local.sh --logs` |
| 停止 | `docker compose down` | `bash scripts/beta-local.sh --stop` |
| 重建 | 推送代码 → GitHub Actions 自动 CI/CD | `bash scripts/beta-local.sh --clean` |

**数据隔离**：本地 beta 使用 `wa-bot/data/` 下的 SQLite 文件；生产环境使用 Droplet 上 `/opt/claimflow/data/` 的挂载卷。两者互不影响。

---

## 文件清单

```
ClaimFlow/
├── docker-compose.yml          # 生产部署（DO）
├── wa-bot/
│   ├── Dockerfile                # 生产镜像（含 Chromium）
│   ├── .env                      # 生产环境变量（Git 不跟踪）
│   └── data/                    # 本地 beta 测试数据（SQLite）
├── scripts/
│   ├── docker.sh                # 生产：远程服务器拉镜像 + 启动
│   ├── setup.sh                # 生产：远程服务器初始化
│   └── beta-local.sh           # 本地：Apple Container 一键启动 ⬅ 新增
└── docs/
    └── beta-local.md           # 本文档 ⬅ 新增
```

---

## 恢复宿主机开发环境

beta 测试完成后，如果想恢复宿主机直接 `node index.js` 开发：

```bash
# 恢复 macOS 原生 node_modules
cd wa-bot/
mv node_modules.mac node_modules

# 宿主机直接启动
node index.js
```

脚本不会删除 `node_modules.mac`，除非你手动运行 `--clean`。
