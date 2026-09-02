create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null,
  phone_number_id text not null unique,
  reject_template_name text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  min_amount numeric(12, 2) not null default 0 check (min_amount >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'reviewer' check (role in ('super_admin', 'reviewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.consumer_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  phone_e164 text not null,
  ic_hash text,
  state text not null default 'waiting_ic',
  receipt_count integer not null default 0 check (receipt_count >= 0),
  last_receipt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, phone_e164)
);

create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  meta_message_id text not null unique,
  phone_e164 text not null,
  message_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  inbound_message_id uuid unique references public.inbound_messages(id) on delete set null,
  phone_e164 text not null,
  ic_last4 text,
  media_path text,
  extracted_amount numeric(12, 2),
  extracted_brand text,
  ai_result jsonb,
  ai_status text not null default 'pending' check (ai_status in ('pending', 'processing', 'complete', 'failed')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  send_status text not null default 'none' check (send_status in ('none', 'queued', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receipt_events (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('message.process', 'receipt.extract', 'whatsapp.send_template')),
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.message_deliveries (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references public.receipts(id) on delete set null,
  provider_message_id text unique,
  template_name text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists inbound_messages_received_at_idx on public.inbound_messages (received_at desc);
create index if not exists receipts_review_queue_idx on public.receipts (review_status, ai_status, created_at desc);
create index if not exists jobs_queue_idx on public.jobs (available_at, created_at) where status = 'queued';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_profiles where id = auth.uid());
$$;

create or replace function public.claim_next_job(p_worker_id text)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  with next_job as (
    select id
    from public.jobs
    where status = 'queued' and available_at <= now()
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.jobs as job
  set status = 'running', locked_at = now(), locked_by = p_worker_id,
      attempts = job.attempts + 1, updated_at = now()
  from next_job
  where job.id = next_job.id
  returning job.*;
$$;

revoke execute on function public.claim_next_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_job(text) to service_role;

alter table public.campaigns enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.consumer_sessions enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_events enable row level security;
alter table public.jobs enable row level security;
alter table public.message_deliveries enable row level security;

create policy "admins can read campaigns" on public.campaigns for select using (public.is_admin());
create policy "super admins manage campaigns" on public.campaigns for all using (exists (select 1 from public.admin_profiles where id = auth.uid() and role = 'super_admin')) with check (exists (select 1 from public.admin_profiles where id = auth.uid() and role = 'super_admin'));
create policy "admins read own profile" on public.admin_profiles for select using (id = auth.uid());
create policy "admins read sessions" on public.consumer_sessions for select using (public.is_admin());
create policy "admins read inbound messages" on public.inbound_messages for select using (public.is_admin());
create policy "admins read receipts" on public.receipts for select using (public.is_admin());
create policy "admins update receipts" on public.receipts for update using (public.is_admin()) with check (public.is_admin());
create policy "admins read receipt events" on public.receipt_events for select using (public.is_admin());
create policy "admins create receipt events" on public.receipt_events for insert with check (public.is_admin());
create policy "admins read deliveries" on public.message_deliveries for select using (public.is_admin());

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do update set public = false;

create policy "admins read receipt files" on storage.objects for select using (bucket_id = 'receipts' and public.is_admin());
