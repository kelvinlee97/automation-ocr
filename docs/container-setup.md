# 容器化部署指南

本项目采用**双轨容器化策略**：生产环境用 Docker Compose 部署到 DigitalOcean，本地 Beta 测试用 Apple Container 在 macOS 上运行。

---

## 快速选择

| 你的目标 | 使用方案 | 文档章节 |
|----------|----------|----------|
| 在 macOS 上快速测试 Admin 后台 | 本地 Beta（Apple Container） | [本地 Beta 测试](#本地-beta-测试apple-container) |
| 部署到生产环境（DO） | 生产部署（Docker Compose） | [生产部署](#生产部署docker-compose--do) |
| 了解两套配置的区别 | 配置对比表 | [配置对比](#配置对比) |

---

## 本地 Beta 测试（Apple Container）

适用于：在 macOS 上快速迭代测试 Admin 后台和 Feedback 功能。

### 前置条件

- macOS 15+
- 安装 Apple Container：`brew install container`
- Node.js 20+（用于本地开发，容器内需重新安装 Linux 版本）

### 一键启动

```bash
bash scripts/beta-local.sh
```

脚本会自动：
1. 检查 `container` CLI 是否可用
2. 备份 macOS `node_modules` → `node_modules.mac`（避免 ELF header 错误）
3. 启动 Apple Container（官方 `node:20-slim` 镜像）
4. 挂载 `wa-bot/` 目录到容器 `/app`
5. 容器内重新 `npm install`（生成 Linux 原生模块）
6. 等待 `localhost:3000` 就绪后打印访问地址

### 访问地址

启动后访问：`http://localhost:3000/admin/setup`（首次创建 admin 账号）

### 脚本参数

| 参数 | 说明 |
|------|------|
| （无参数） | 正常启动（后台运行） |
| `--clean` | 停止容器 + 删除 Linux `node_modules` + 恢复 macOS `node_modules.mac` |
| `--stop` | 停止并删除容器（保留 `node_modules`） |
| `--logs` | 查看容器实时日志 |

### 常见错误

#### `invalid ELF header`（`better-sqlite3`）

**原因**：`node_modules/` 里的原生模块是 macOS 编译的，容器内是 Linux。

**解决**：脚本会自动处理。如果手动操作：
```bash
mv wa-bot/node_modules wa-bot/node_modules.mac
bash scripts/beta-local.sh
```

#### `Address already in use`（端口 3000 被占用）

```bash
lsof -i :3000 | grep LISTEN   # 找到 PID
kill -9 <PID>
bash scripts/beta-local.sh
```

#### Puppeteer/Chromium 启动失败（不影响 beta 测试）

**现象**：日志显示 `Failed to launch the browser process`，但 Admin 后台正常启动。

**原因**：本地 beta 用的 `node:20-slim` 不含 Chromium 依赖。

**影响范围**：仅影响 WhatsApp Bot 功能；Admin 后台、Feedback 页面完全正常。

### 恢复宿主机开发环境

beta 测试完成后，恢复宿主机直接运行：

```bash
cd wa-bot/
mv node_modules.mac node_modules
node index.js
```

---

## 生产部署（Docker Compose + DO）

适用于：部署稳定版本到 DigitalOcean Droplet，对外提供服务。

### 架构

```
外部请求 → :80/:443 → Caddy（反向代理 + HTTPS）→ :3000 (wa-bot 容器)
```

| 组件 | 镜像 | 职责 |
|------|------|------|
| Caddy | `caddy:2-alpine` | 反向代理、HTTPS 终止、自动证书申请 |
| wa-bot | 自建（`wa-bot/Dockerfile`） | Express Admin 后台 + WhatsApp Bot |

### 前置条件

- DigitalOcean Droplet（已配置：`159.65.136.11`，Ubuntu 24.04）
- 域名解析已配置（如 `kelvin.ink` → Droplet IP）
- GitHub Secrets 已配置（见下方）

### GitHub Secrets

| Secret | 值 |
|--------|-----|
| `DO_SSH_HOST` | `159.65.136.11` |
| `DO_SSH_USER` | `deploy` |
| `DO_SSH_KEY` | CI/CD ed25519 私钥 |
| `GHCR_PAT` | GitHub PAT（read:packages） |

### 自动部署（推荐）

推送代码到 `main` 分支，GitHub Actions 自动执行：

1. **CI 阶段**：lint → test → docker build（验证）
2. **Deploy 阶段**：构建镜像 → 推送到 GHCR → SSH 到 DO → `docker compose pull && docker compose up -d`

### 手动部署（应急）

```bash
ssh deploy@159.65.136.11
cd /opt/automation-ocr
git pull origin main
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
```

### 查看日志

```bash
ssh deploy@159.65.136.11
cd /opt/automation-ocr
docker compose logs -f --tail=100 wa-bot
```

---

## 配置对比

### 环境变量

| 变量 | 生产（`.env`） | 本地 Beta（`.env`） | 说明 |
|------|------------------|----------------------|------|
| `NODE_ENV` | `production` | `development` | |
| `GEMINI_API_KEY` | **必填** | 可选（可留空） | AI OCR 识别 |
| `GITHUB_TOKEN` | 可选 | 可选（可留空） | Feedback → GitHub Issues |
| `SESSION_SECRET` | **必填** | 自动生成 | Session 加密密钥 |
| `DOMAIN` | **必填** | 不需要 | Caddy 域名配置 |
| `DATA_DIR` | `/opt/automation-ocr/data` | `./data` | 数据目录 |

### 端口映射

| 环境 | 外部端口 | 容器端口 | 说明 |
|------|----------|----------|------|
| 生产 | 80/443 | 3000（wa-bot） | Caddy 反向代理 |
| 本地 Beta | 3000 | 3000 | 直接访问 |

### 镜像策略

| 环境 | 镜像来源 | 构建方式 |
|------|----------|----------|
| 生产 | `ghcr.io/kelvinlee97/automation-ocr:latest` | `wa-bot/Dockerfile`（含 Chromium） |
| 本地 Beta | `docker.io/library/node:20-slim` | 官方镜像，容器内 `npm install` |

---

## 本地构建镜像（可选）

如果需要本地构建 beta 镜像（利用 Docker layer 缓存，避免每次启动都 `npm install`）：

```bash
cd wa-bot/
container build -t wa-bot:beta -f Dockerfile.beta .
```

然后使用自定义镜像启动（修改 `scripts/beta-local.sh` 中的 `IMAGE` 变量）。

---

## 文件清单

| 文件路径 | 用途 | 环境 |
|----------|------|------|
| `docker-compose.yml` | 生产编排（Caddy + wa-bot） | 生产（DO） |
| `wa-bot/Dockerfile` | 生产镜像构建（含 Chromium） | 生产（DO） |
| `wa-bot/Dockerfile.beta` | 本地 beta 镜像构建（不含 Chromium） | 本地 Beta |
| `wa-bot/.dockerignore` | Docker 构建排除规则 | 通用 |
| `Caddyfile` | Caddy 反向代理配置 | 生产（DO） |
| `scripts/beta-local.sh` | 本地 Apple Container 启动脚本 | 本地 Beta |
| `scripts/docker.sh` | 生产 Docker 操作封装 | 生产（DO） |
| `scripts/bootstrap.sh` | DO Droplet 一键部署 | 生产（DO） |
| `wa-bot/.env.example` | 环境变量模板 | 通用 |

---

## 故障排查

### 生产环境

| 问题 | 排查命令 |
|------|----------|
| 网站无法访问 | `ssh deploy@159.65.136.11` → `docker compose ps` |
| HTTPS 证书失败 | `docker compose logs -f caddy` |
| Bot 无法启动 | `docker compose logs -f wa-bot` |

### 本地 Beta

| 问题 | 排查命令 |
|------|----------|
| 容器无法启动 | `container logs wa-bot-beta` |
| 端口被占用 | `lsof -i :3000` |
| `npm install` 失败 | `container logs wa-bot-beta`（查看详细错误） |
