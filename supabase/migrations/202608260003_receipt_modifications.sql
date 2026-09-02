create table if not exists public.receipt_modifications (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  modified_at timestamptz not null default now(),
  modified_by uuid references auth.users(id) on delete set null,
  field_name text not null check (field_name in ('amount', 'brand')),
  old_value text,
  new_value text
);

create index if not exists receipt_modifications_receipt_idx
  on public.receipt_modifications (receipt_id, modified_at desc);

alter table public.receipt_modifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'receipt_modifications'
      and policyname = 'admins read receipt modifications'
  ) then
    create policy "admins read receipt modifications"
      on public.receipt_modifications for select
      using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'receipt_modifications'
      and policyname = 'admins create receipt modifications'
  ) then
    create policy "admins create receipt modifications"
      on public.receipt_modifications for insert
      with check (public.is_admin());
  end if;
end $$;

create or replace function public.correct_receipt_extraction(p_receipt_id uuid, p_extraction jsonb)
returns setof public.receipts
language plpgsql
set search_path = public
as $$
declare
  current_receipt public.receipts;
  changed_fields text[] := '{}';
begin
  select * into current_receipt from public.receipts where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  if current_receipt.review_status <> 'pending' or current_receipt.ai_status <> 'complete' then
    raise exception 'Receipt changed';
  end if;

  if current_receipt.ai_result->'amount' is distinct from p_extraction->'amount' then
    insert into public.receipt_modifications (receipt_id, modified_by, field_name, old_value, new_value)
    values (p_receipt_id, auth.uid(), 'amount', current_receipt.ai_result->>'amount', p_extraction->>'amount');
    changed_fields := array_append(changed_fields, 'amount');
  end if;
  if current_receipt.ai_result->'brand' is distinct from p_extraction->'brand' then
    insert into public.receipt_modifications (receipt_id, modified_by, field_name, old_value, new_value)
    values (p_receipt_id, auth.uid(), 'brand', current_receipt.ai_result->>'brand', p_extraction->>'brand');
    changed_fields := array_append(changed_fields, 'brand');
  end if;

  update public.receipts
  set extracted_amount = (p_extraction->>'amount')::numeric,
      extracted_brand = p_extraction->>'brand',
      ai_result = p_extraction,
      updated_at = now()
  where id = p_receipt_id;

  insert into public.receipt_events (receipt_id, actor_id, event_type, metadata)
  values (p_receipt_id, auth.uid(), 'extraction_corrected', jsonb_build_object('fields', changed_fields));

  return query select * from public.receipts where id = p_receipt_id;
end;
$$;

revoke execute on function public.correct_receipt_extraction(uuid, jsonb) from public, anon;
grant execute on function public.correct_receipt_extraction(uuid, jsonb) to authenticated;

create or replace function public.review_receipt(p_receipt_id uuid, p_decision text)
returns setof public.receipts
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_receipt public.receipts;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'Invalid review decision'; end if;

  select * into current_receipt from public.receipts where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  if current_receipt.review_status <> 'pending' then raise exception 'Receipt was already reviewed'; end if;
  if p_decision = 'approved' and current_receipt.ai_status <> 'complete' then raise exception 'AI extraction is not complete'; end if;

  update public.receipts set review_status = p_decision, updated_at = now() where id = p_receipt_id;
  insert into public.receipt_events (receipt_id, actor_id, event_type, from_status, to_status)
  values (p_receipt_id, auth.uid(), p_decision, 'pending', p_decision);

  return query select * from public.receipts where id = p_receipt_id;
end;
$$;

revoke execute on function public.review_receipt(uuid, text) from public, anon;
grant execute on function public.review_receipt(uuid, text) to authenticated;
