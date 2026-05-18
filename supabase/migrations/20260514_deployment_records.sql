-- Deploy Management control-plane storage.
-- Run this in Supabase SQL Editor before setting DEPLOYMENT_STORAGE=supabase.

create extension if not exists pgcrypto;

create table if not exists public.deployment_records (
  id uuid primary key default gen_random_uuid(),
  collection text not null,
  entity_id text not null,
  payload jsonb not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deployment_records_collection_entity_unique unique (collection, entity_id),
  constraint deployment_records_payload_has_id check (payload ? 'id')
);

create index if not exists deployment_records_collection_sort_idx
  on public.deployment_records (collection, sort_order);

create index if not exists deployment_records_collection_updated_idx
  on public.deployment_records (collection, updated_at desc);

create index if not exists deployment_records_payload_gin_idx
  on public.deployment_records using gin (payload jsonb_path_ops);

create or replace function public.set_deployment_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists deployment_records_set_updated_at on public.deployment_records;

create trigger deployment_records_set_updated_at
before update on public.deployment_records
for each row
execute function public.set_deployment_records_updated_at();

create or replace function public.replace_deployment_records(
  p_collection text,
  p_records jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_collection is null or length(trim(p_collection)) = 0 then
    raise exception 'p_collection is required';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array';
  end if;

  with incoming as (
    select
      record.value ->> 'id' as entity_id,
      record.value as payload,
      (record.ordinality - 1)::integer as sort_order
    from jsonb_array_elements(p_records) with ordinality as record(value, ordinality)
  ),
  valid_incoming as (
    select *
    from incoming
    where entity_id is not null and length(trim(entity_id)) > 0
  ),
  deleted as (
    delete from public.deployment_records existing
    where existing.collection = p_collection
      and not exists (
        select 1
        from valid_incoming next_records
        where next_records.entity_id = existing.entity_id
      )
    returning existing.entity_id
  )
  insert into public.deployment_records (collection, entity_id, payload, sort_order)
  select p_collection, entity_id, payload, sort_order
  from valid_incoming
  on conflict (collection, entity_id)
  do update set
    payload = excluded.payload,
    sort_order = excluded.sort_order;
end;
$$;

alter table public.deployment_records enable row level security;

drop policy if exists "service role manages deployment records" on public.deployment_records;

create policy "service role manages deployment records"
on public.deployment_records
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

revoke all on public.deployment_records from anon;
grant select, insert, update, delete on public.deployment_records to service_role;
grant execute on function public.replace_deployment_records(text, jsonb) to service_role;
