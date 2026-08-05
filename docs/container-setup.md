# Containerization Deployment Guide

This project adopts a **dual-track containerization strategy**: the production environment uses Docker Compose to deploy to DigitalOcean, and the local beta test uses Apple Container to run on macOS.

---

## Quick selection

| your goals | Usage plan | Documentation Chapter |
|----------|----------|----------|
| Quickly test the Admin backend on macOS | Local Beta (Apple Container) | [Local Beta Test](#local-beta-testapple-container) |
| Deploy to production (DO) | Production deployment (Docker Compose) | [Production deployment](#production deployment docker-compose--do) |
| Understand the differences between the two configurations | Configuration comparison table | [Configuration comparison](#configuration comparison) |

---

## Local Beta Testing (Apple Container)

Best for: Quickly iteratively test Admin backend and Feedback functionality on macOS.

### Preconditions

- macOS 15+
- Install Apple Container: `brew install container`
- Node.js 20+ (for local development, the Linux version needs to be reinstalled in the container)

### One click start

```bash
bash scripts/beta-local.sh
```

The script will automatically:
1. Check if `container` CLI is available
2. Backup macOS `node_modules` → `node_modules.mac` (avoid ELF header errors)
3. Start Apple Container (official `node:20-slim` image)
4. Mount the `wa-bot/` directory to the container `/app`
5. Re-run `npm install` in the container (generate Linux native module)
6. Wait for `localhost:3000` to be ready and then print the access address

### Access address

After startup, visit: `http://localhost:3000/admin/setup` (create admin account for the first time)

### Script parameters

| parameter | illustrate |
|------|------|
| (no parameters) | Normal startup (running in the background) |
| `--clean` | Stop container + remove Linux `node_modules` + restore macOS `node_modules.mac` |
| `--stop` | Stop and remove the container (keep `node_modules`) |
| `--logs` | View container real-time logs |

### Common mistakes

#### `invalid ELF header` (`better-sqlite3`)

**Reason**: The native modules in `node_modules/` are compiled for macOS, and the container is Linux.

**Solution**: The script will handle it automatically. If doing it manually:
```bash
mv wa-bot/node_modules wa-bot/node_modules.mac
bash scripts/beta-local.sh
```

#### `Address already in use` (port 3000 is occupied)

```bash
lsof -i :3000 | grep LISTEN # Find PID
kill -9 <PID>
bash scripts/beta-local.sh
```

#### Puppeteer/Chromium fails to start (does not affect beta testing)

**Phenomenon**: The log shows `Failed to launch the browser process`, but the Admin background starts normally.

**Reason**: The `node:20-slim` used by the local beta does not contain Chromium dependencies.

**Scope of impact**: Only affects the WhatsApp Bot function; the Admin background and Feedback page are completely normal.

### Restore the host development environment

After the beta test is completed, restore the host and run directly:

```bash
cd wa-bot/
mv node_modules.mac node_modules
node index.js
```

---

## Production deployment (Docker Compose + DO)

Applicable to: deploying the stable version to DigitalOcean Droplet to provide external services.

### Architecture

```
External requests → :80/:443 → Caddy (reverse proxy + HTTPS) → :3000 (wa-bot container)
```

| components | mirror | Responsibilities |
|------|------|------|
| Caddy | `caddy:2-alpine` | Reverse proxy, HTTPS termination, automatic certificate request |
| wa-bot | Self-built (`wa-bot/Dockerfile`) | Express Admin Backend + WhatsApp Bot |

### Preconditions

- DigitalOcean Droplet (Configured: `<DROPLET_IP>`, Ubuntu 24.04)
- Domain name resolution has been configured (such as `kelvin.ink` → Droplet IP)
- GitHub Secrets configured (see below)

### GitHub Secrets

| Secret | value |
|--------|-----|
| `DO_SSH_HOST` | `<DROPLET_IP>` |
| `DO_SSH_USER` | `deploy` |
| `DO_SSH_KEY` | CI/CD ed25519 private key |
| `GHCR_PAT` | GitHub PAT (read:packages) |

### Automatic deployment (recommended)

Push the code to the `main` branch and GitHub Actions will execute it automatically:

1. **CI phase**: lint → test → docker build (verification)
2. **Deploy phase**: Build image → Push to GHCR → SSH to DO → `docker compose pull && docker compose up -d`

### Manual deployment (emergency)

```bash
ssh deploy@<DROPLET_IP>
cd /opt/claimflow
git pull origin main
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
```

### View log

```bash
ssh deploy@<DROPLET_IP>
cd /opt/claimflow
docker compose logs -f --tail=100 wa-bot
```

---

## Configuration comparison

### environment variables

| variable | production(`.env`) | Local Beta (`.env`) | illustrate |
|------|------------------|----------------------|------|
| `NODE_ENV` | `production` | `development` | |
| `GEMINI_API_KEY` | **Required** | Optional (can be left blank) | AI OCR recognition |
| `GITHUB_TOKEN` | Optional | Optional (can be left blank) | Feedback → GitHub Issues |
| `SESSION_SECRET` | **Required** | Automatically generated | Session encryption key |
| `DOMAIN` | **Required** | unnecessary | Caddy domain name configuration |
| `DATA_DIR` | `/opt/claimflow/data` | `./data` | data directory |

### port mapping

| environment | external port | container port | illustrate |
|------|----------|----------|------|
| Production | 80/443 | 3000 (wa-bot) | Caddy reverse proxy |
| Local Beta | 3000 | 3000 | direct access |

### Mirroring strategy

| environment | Mirror source | How to build |
|------|----------|----------|
| Production | `ghcr.io/kelvinlee97/claimflow:latest` | `wa-bot/Dockerfile` (including Chromium) |
| Local Beta | `docker.io/library/node:20-slim` | Official image, `npm install` in the container |

---

## Build the image locally (optional)

If you need to build the beta image locally (use Docker layer cache to avoid `npm install` every time you start it):

```bash
cd wa-bot/
container build -t wa-bot:beta -f Dockerfile.beta .
```

Then start using a custom image (modify the `IMAGE` variable in `scripts/beta-local.sh`).

---

## Document list

| file path | use | environment |
|----------|------|------|
| `docker-compose.yml` | Production orchestration (Caddy + wa-bot) | Production(DO) |
| `wa-bot/Dockerfile` | Production image build (including Chromium) | Production(DO) |
| `wa-bot/Dockerfile.beta` | Local beta image build (without Chromium) | Local Beta |
| `wa-bot/.dockerignore` | Docker build exclusion rules | Universal |
| `Caddyfile` | Caddy reverse proxy configuration | Production(DO) |
| `scripts/beta-local.sh` | Local Apple Container startup script | Local Beta |
| `scripts/docker.sh` | Production Docker Operation Encapsulation | Production(DO) |
| `scripts/bootstrap.sh` | DO Droplet one-click deployment | Production(DO) |
| `wa-bot/.env.example` | Environment variable template | Universal |

---

## Troubleshooting

### production environment

| question | troubleshooting command |
|------|----------|
| Website cannot be accessed | `ssh deploy@<DROPLET_IP>` → `docker compose ps` |
| HTTPS certificate failed | `docker compose logs -f caddy` |
| Bot cannot start | `docker compose logs -f wa-bot` |

### Local Beta

| question | troubleshooting command |
|------|----------|
| Container cannot start | `container logs wa-bot-beta` |
| Port is occupied | `lsof -i :3000` |
| `npm install` failed | `container logs wa-bot-beta` (see detailed errors) |
