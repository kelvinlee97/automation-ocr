# ClaimFlow v1 rebuild

The new runtime is split into three small boundaries:

- `apps/admin`: Next.js App Router admin UI and the Meta webhook route, deployed to Vercel.
- `apps/worker`: Node 24 worker for queued media processing, GPT-5.6 Luna extraction and WhatsApp Cloud API sends.
- `packages/domain`: shared status and webhook schemas.
- `supabase/migrations`: Postgres, RLS, private receipt storage and the queue claim function.

The old `wa-bot/` application remains available as the production rollback/archive path and uses the same four-field Luna extraction contract. Its non-OCR behavior is unchanged. Do not run WhatsApp Web and Cloud API against the same number during cutover.

Docker is optional for this runtime. Vercel hosts the Admin and webhook, Supabase hosts the data plane, and the Worker can run as a normal long-lived Node.js process on any Node host. Keep the Worker out of the webhook request so media downloads and Luna retries remain asynchronous.

## Local admin preview

```bash
npm install
NEXT_PUBLIC_DEMO_MODE=true npm run admin:dev
```

The demo data is only enabled by the explicit flag. With the flag off and no Supabase URL, the queue is empty rather than silently pretending to be production data.

## Vercel project

Create a Vercel project from this repository with the Root Directory set to `apps/admin`. Use these build settings so the workspace dependencies are installed from the repository root:

- Install Command: `cd ../.. && npm ci`
- Build Command: `cd ../.. && npm run admin:build`
- Output Directory: `.next`

Add the variables from `apps/admin/.env.example` to the Vercel project. The publishable/anon key may be exposed to the browser; the service-role key and Meta secrets must stay server-side. The rejection template name is stored on each Campaign in Supabase.

## Supabase

Apply every SQL file in `supabase/migrations/` in filename order to a new project. Create the first `auth.users` account in Supabase Auth, then insert its UUID into `public.admin_profiles` with either `reviewer` or `super_admin`.

The browser receives only the publishable/anon key. The service-role key belongs in the webhook/worker deployment only.

## Meta webhook

Point the WhatsApp Business webhook at `/api/webhooks/whatsapp`. Set `META_WEBHOOK_VERIFY_TOKEN` for the GET challenge and `META_APP_SECRET` for `x-hub-signature-256`. The POST handler stores each Meta message ID with a unique constraint and enqueues one processing job.

## TODO

- [ ] Deferred — configure Meta/WhatsApp Cloud API credentials (`META_ACCESS_TOKEN`, `META_APP_SECRET`, and `META_WEBHOOK_VERIFY_TOKEN`), then run a live webhook, media download, and template-send smoke test before cutover.
- [x] Verified — `SUPABASE_SERVICE_ROLE_KEY` in `apps/admin/.env.local` and `apps/worker/.env` uses the Supabase secret/service-role key, and Worker access to `claim_next_job` is working.

## Worker

```bash
cp apps/worker/.env.example apps/worker/.env
set -a; . apps/worker/.env; set +a
npm run worker:dev
```

`OPENAI_API_KEY` belongs only in `apps/worker/.env` for the new runtime; Docker Compose loads that file automatically. Never prefix it with `NEXT_PUBLIC_` or place it in browser code.

Or build the isolated container:

```bash
docker compose -f docker-compose.new.yml up --build worker
```

The worker exposes `/health` on port 8080. It requires the Supabase migration before it can claim jobs.

For a direct Node deployment, run the same worker without a container:

```bash
npm ci --omit=dev
npm --workspace apps/worker run start
```

Set `NODE_ENV=production`; the Worker fails at startup if its Meta or OpenAI credentials are missing. Docker Compose remains an optional packaging path, not a product requirement.

## Cutover boundary

This first slice intentionally does not migrate old SQLite/Excel rows into runtime Postgres. Keep those files as a read-only archive and validate the new number in a separate Meta setup before switching traffic.
