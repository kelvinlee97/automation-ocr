begin;

insert into public.receipts (id, phone_e164, ai_status, review_status)
values ('00000000-0000-0000-0000-000000000001', '+60000000000', 'complete', 'pending');

create function pg_temp.fail_review_event()
returns trigger
language plpgsql
as $$
begin
  if new.receipt_id = '00000000-0000-0000-0000-000000000001' then
    raise exception 'expected audit failure';
  end if;
  return new;
end;
$$;

create trigger fail_review_event
before insert on public.receipt_events
for each row execute function pg_temp.fail_review_event();

do $$
begin
  begin
    perform * from public.review_receipt('00000000-0000-0000-0000-000000000001', 'approved');
    raise exception 'review unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'expected audit failure' then raise; end if;
  end;

  if (select review_status from public.receipts where id = '00000000-0000-0000-0000-000000000001') <> 'pending' then
    raise exception 'review update was not rolled back';
  end if;
end;
$$;

rollback;
