alter table public.jobs add column if not exists claim_token uuid;
alter table public.message_deliveries add column if not exists attempt_id uuid not null default gen_random_uuid();
create unique index if not exists message_deliveries_attempt_id_idx on public.message_deliveries (attempt_id);
alter table public.message_deliveries drop constraint if exists message_deliveries_status_check;
alter table public.message_deliveries add constraint message_deliveries_status_check check (status in ('queued', 'sending', 'sent', 'failed', 'unknown'));

-- Reclaim jobs left running by a crashed worker. Active workers renew this lease.
create or replace function public.claim_next_job(p_worker_id text)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  with next_job as (
    select id
    from public.jobs
    where (
      status = 'queued' and available_at <= now()
    ) or (
      status = 'running' and locked_at <= now() - interval '5 minutes'
    )
    order by
      case when status = 'running' then 0 else 1 end,
      available_at,
      created_at
    for update skip locked
    limit 1
  )
  update public.jobs as job
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker_id,
      claim_token = gen_random_uuid(),
      last_error = null,
      attempts = job.attempts + 1,
      updated_at = now()
  from next_job
  where job.id = next_job.id
  returning job.*;
$$;

revoke execute on function public.claim_next_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_job(text) to service_role;

create or replace function public.renew_job_lease(p_job_id uuid, p_claim_token uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.jobs
  set locked_at = now(), updated_at = now()
  where id = p_job_id and status = 'running' and claim_token = p_claim_token
  returning true;
$$;

create or replace function public.finish_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_last_error text default null,
  p_available_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('queued', 'completed', 'failed') then
    raise exception 'Invalid terminal job status';
  end if;

  update public.jobs
  set status = p_status,
      available_at = coalesce(p_available_at, available_at),
      last_error = p_last_error,
      locked_at = null,
      locked_by = null,
      claim_token = null,
      updated_at = now()
  where id = p_job_id and status = 'running' and claim_token = p_claim_token;
  return found;
end;
$$;

revoke execute on function public.renew_job_lease(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.finish_job(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.renew_job_lease(uuid, uuid) to service_role;
grant execute on function public.finish_job(uuid, uuid, text, text, timestamptz) to service_role;
