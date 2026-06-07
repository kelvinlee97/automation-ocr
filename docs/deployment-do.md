# DigitalOcean 部署架构

## 当前状态

- **Droplet IP**: `159.65.136.11`（Singapore, sgp1）
- **域名**: `kelvin.ink`（HTTPS，Let's Encrypt，有效期至 2026-09-05）
- **管理后台**: `https://kelvin.ink/admin/login`（用户名 `kelvin` / 密码 `kelvin`）
- **迁移完成时间**: 2026-06-07

## 架构

```
GitHub Actions (CI/CD)
  │  push main
  │  ssh → deploy@159.65.136.11
  ▼
Droplet (Ubuntu 24.04)
  ├── Caddy (reverse proxy + TLS)
  └── wa-bot (Docker, GHCR image)
        └── data/ (volume: app.db + images/)
```

- CI Deploy 用原生 `ssh` 命令（不用 `appleboy/ssh-action`）
- 镜像从 GHCR 拉取（`ghcr.io/kelvinlee97/automation-ocr:main`）
- 运行时数据在 `/opt/automation-ocr/data`（Docker volume）

## Droplet 规格

| 项目 | 值 |
|------|-----|
| Region | Singapore (sgp1) |
| Image | Ubuntu 24.04 LTS |
| Size | 1 vCPU / 2GB / 50GB SSD |
| 用户 | `deploy`（CI/CD 用） + `root`（管理） |

## DigitalOcean 云端防火墙

| 协议 | 端口 | 来源 | 用途 |
|------|------|------|------|
| TCP  | 22   | All IPv4 + All IPv6 | SSH（GitHub Actions 需要） |
| TCP  | 80   | All IPv4 + All IPv6 | HTTP（Let's Encrypt challenge） |
| TCP  | 443  | All IPv4 + All IPv6 | HTTPS |
| UDP  | 443  | All IPv4 + All IPv6 | HTTP/3 |

## GitHub Secrets

| Secret | 值 |
|--------|-----|
| `DO_SSH_HOST` | `159.65.136.11` |
| `DO_SSH_USER` | `deploy` |
| `DO_SSH_KEY` | CI/CD ed25519 私钥 |
| `GHCR_PAT` | GitHub PAT（read:packages） |

`DO_SSH_PORT` 已删除（hardcode 22 在 yml 里）。`AWS_DEPLOY_ROLE_ARN` 已删除。

## 手动部署（应急）

```bash
ssh deploy@159.65.136.11
cd /opt/automation-ocr
git pull origin main          # 如果 .env / docker-compose.yml 有改动
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
```

## 日志查看

```bash
ssh deploy@159.65.136.11
cd /opt/automation-ocr
docker compose logs -f --tail=100 wa-bot
```

## AWS 已清理

- CloudFormation stack `automation-ocr` 已删除（2026-06-07）
- GitHub AWS 相关 secret 已删除
