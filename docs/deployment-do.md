# Archived DigitalOcean deployment architecture

> This document describes the legacy `wa-bot` + Docker deployment only. It is not the default production path. The target path is documented in [rebuild-v1.md](rebuild-v1.md): Vercel + Supabase + a standalone Node Worker.

## Current status

- **Droplet IP**: `<DROPLET_IP>` (Singapore, sgp1)
- **Domain name**: `kelvin.ink` (HTTPS, Let's Encrypt, valid until 2026-09-05)
- **admin panel**: `https://kelvin.ink/admin/login` (username `kelvin` / password `kelvin`)
- **Migration completion time**: 2026-06-07

## Architecture

```
GitHub Actions (CI/CD)
  │  push main
  │  ssh → deploy@<DROPLET_IP>
  ▼
Droplet (Ubuntu 24.04)
  ├── Caddy (reverse proxy + TLS)
  └── wa-bot (Docker, GHCR image)
        └── data/ (volume: app.db + images/)
```

- CI Deploy uses native `ssh` command (without `appleboy/ssh-action`)
- Image pulled from GHCR (`ghcr.io/kelvinlee97/claimflow:latest`)
- Runtime data is in `/opt/claimflow/data` (Docker volume)

## Droplet specifications

| project | value |
|------|-----|
| Region | Singapore (sgp1) |
| Image | Ubuntu 24.04 LTS |
| Size | 1 vCPU / 2GB / 50GB SSD |
| user | `deploy` (for CI/CD) + `root` (management) |

## DigitalOcean Cloud Firewall

| protocol | port | source | use |
|------|------|------|------|
| TCP | 22 | All IPv4 + All IPv6 | SSH (required by GitHub Actions) |
| TCP  | 80   | All IPv4 + All IPv6 | HTTP (Let's Encrypt challenge) |
| TCP  | 443  | All IPv4 + All IPv6 | HTTPS |
| UDP  | 443  | All IPv4 + All IPv6 | HTTP/3 |

## GitHub Secrets

| Secret | value |
|--------|-----|
| `DO_SSH_HOST` | `<DROPLET_IP>` |
| `DO_SSH_USER` | `deploy` |
| `DO_SSH_KEY` | CI/CD ed25519 private key |
| `GHCR_PAT` | GitHub PAT (read:packages) |

`DO_SSH_PORT` has been removed (hardcode 22 in yml). `AWS_DEPLOY_ROLE_ARN` has been removed.

## Manual deployment (emergency)

```bash
ssh deploy@<DROPLET_IP>
cd /opt/claimflow
git pull origin main # If there are changes in .env / docker-compose.yml
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
```

## Log view

```bash
ssh deploy@<DROPLET_IP>
cd /opt/claimflow
docker compose logs -f --tail=100 wa-bot
```

## AWS Cleaned

- CloudFormation stack `claimflow` deleted (2026-06-07)
- GitHub AWS related secret has been deleted
