# Legacy Local Beta Testing Environment (Apple Container)

> This document targets the archived `wa-bot` runtime. It is not required for the new Next.js + Supabase + Node Worker path.

## Why do we need two sets of container configurations?

|  | Production Deployment (DO) | Local beta testing (macOS) |
|---|---|---|
| tool | Docker Compose | Apple Container (`container` CLI) |
| mirror | Self-build (`docker build`) | Official `node:22-slim` |
| `node_modules` | In the image `npm ci` | Mount the local directory and re-run `npm install` in the container |
| port | 80/443 (Caddy agent) | 3000 (direct access) |
| SQLite data | `/opt/claimflow/data` | `wa-bot/data/` (mount) |
| Chromium/Puppeteer | Install within the image (`apt-get`) | ❌ Not enabled yet (Bot function does not require beta testing) |

**Core difference**: The production environment uses a multi-stage `Dockerfile` to build an image containing Chromium; the local beta test only needs to be able to run the Express Admin backend, and does not require Chromium or Caddy.

---

## quick start

```bash
bash scripts/beta-local.sh
```

The first run will automatically:
1. Check if Apple Container is installed (`brew install container`)
2. Backup macOS native `node_modules` → `node_modules.mac`
3. Pull the `docker.io/library/node:22-slim` image (about 200MB)
4. `npm install` inside the container (compile the Linux version of the native module)
5. Wait for `localhost:3000` to return the HTTP status code, then print the access address

**First visit**: `<a href="http://localhost:3000/admin/setup">http://localhost:3000/admin/setup</a>` Create an admin account.

---

## Common errors and solutions

### 1. `Error: /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node: invalid ELF header`

**Reason**: The `.node` file of `better-sqlite3` in `node_modules/` is in macOS Mach-O format, and the container is Linux.

**Solution**: The script will automatically rename `node_modules` to `node_modules.mac`, allowing `npm install` to regenerate the Linux version in the container.

If done manually:
```bash
mv wa-bot/node_modules wa-bot/node_modules.mac
bash scripts/beta-local.sh
```

### 2. `bind: Address already in use` (port 3000 is occupied)

**Cause**: There is another Node process running port 3000.

**solve**:
```bash
lsof -i :3000 | grep LISTEN # Find PID
kill -9 <PID> # kill
bash scripts/beta-local.sh
```

### 3. Puppeteer/Chromium fails to start (does not affect beta testing)

**Phenomenon**: The container log shows `Failed to launch the browser process`, but the `admin panel has been started, listening on port 3000`.

**Cause**: Chromium is not installed in the local beta test (the `node:22-slim` image does not contain Chromium dependencies).

**Scope of impact**: Only the AI automatic recognition function of receipt amount is affected; the Admin background and feedback page are completely normal.

**If you really need Puppeteer**: Use the complete `node:22` image (about 1GB+) instead, and add `--cap-add=SYS_PTRACE` and other parameters when `container run`.

### 4. How to restart after modifying the code?

```bash
bash scripts/beta-local.sh --stop # Stop the container
bash scripts/beta-local.sh # Restart (the code is mounted, and the modification takes effect immediately)
```

> ⚠️ If you modify `package.json`, you need to delete `node_modules` in the container and reinstall it. Cleanest way:
> ```bash
> bash scripts/beta-local.sh --clean # Stop container + delete node_modules
> bash scripts/beta-local.sh # Reinstall dependencies + start
> ```

---

## Switching to production deployment

| operate | Production(DO) | Local Beta |
|---|---|---|
| start up | `ssh root@<DROPLET_IP>` → `cd /opt/claimflow && docker compose up -d` | `bash scripts/beta-local.sh` |
| View log | `docker compose logs -f` | `bash scripts/beta-local.sh --logs` |
| stop | `docker compose down` | `bash scripts/beta-local.sh --stop` |
| reconstruction | Push code → GitHub Actions Automated CI/CD | `bash scripts/beta-local.sh --clean` |

**Data Isolation**: The local beta uses SQLite files under `wa-bot/data/`; the production environment uses the mounted volume on `/opt/claimflow/data/` on the Droplet. The two have no influence on each other.

---

## Document list

```
ClaimFlow/
├── docker-compose.yml # Production deployment (DO)
├── wa-bot/
│ ├── Dockerfile # Production image (including Chromium)
│ ├── .env # Production environment variables (not tracked by Git)
│ └── data/ # Local beta test data (SQLite)
├── scripts/
│ ├── docker.sh # Production: pull image from remote server + start
│ ├── setup.sh # Production: remote server initialization
│ └── beta-local.sh # Local: Apple Container one-click startup ⬅ New
└── docs/
    └── beta-local.md # This document ⬅ New
```

---

## Restore the host development environment

After the beta test is completed, if you want to restore the host machine, develop `node index.js` directly:

```bash
# Restore macOS native node_modules
cd wa-bot/
mv node_modules.mac node_modules

# Host starts directly
node index.js
```

The script will not delete `node_modules.mac` unless you run `--clean` manually.
