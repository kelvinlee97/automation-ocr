alter table public.campaigns
  add column if not exists reject_template_name text;
