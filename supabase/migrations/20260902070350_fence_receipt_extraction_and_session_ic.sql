alter table public.consumer_sessions add column if not exists ic_last4 text;
alter table public.consumer_sessions drop column if exists ic_hash;
create unique index consumer_sessions_campaign_phone_nulls_not_distinct_idx
on public.consumer_sessions (campaign_id, phone_e164) nulls not distinct;

create or replace function public.update_receipt_extraction_for_claim(
  p_job_id uuid,
  p_claim_token uuid,
  p_receipt_id uuid,
  p_ai_status text default null,
  p_ai_result jsonb default null,
  p_extracted_amount numeric default null,
  p_extracted_brand text default null,
  p_media_path text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.jobs
  where id = p_job_id and status = 'running' and claim_token = p_claim_token
  for update;
  if not found then return false; end if;
  if p_ai_status is not null and p_ai_status not in ('processing', 'complete', 'failed') then
    raise exception 'Invalid AI status';
  end if;

  update public.receipts
  set ai_status = coalesce(p_ai_status, ai_status),
      ai_result = case when p_ai_status is null then ai_result else p_ai_result end,
      extracted_amount = case when p_ai_status = 'complete' then p_extracted_amount else extracted_amount end,
      extracted_brand = case when p_ai_status = 'complete' then p_extracted_brand else extracted_brand end,
      media_path = coalesce(p_media_path, media_path),
      updated_at = now()
  where id = p_receipt_id and review_status = 'pending';
  return found;
end;
$$;

revoke execute on function public.update_receipt_extraction_for_claim(uuid, uuid, uuid, text, jsonb, numeric, text, text) from public, anon, authenticated;
grant execute on function public.update_receipt_extraction_for_claim(uuid, uuid, uuid, text, jsonb, numeric, text, text) to service_role;
