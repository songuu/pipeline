-- Deploy Management domain-table storage.
-- Run this after 20260514_deployment_records.sql if you already used the
-- generic store, or run it directly for new Supabase projects.

create extension if not exists pgcrypto;

create or replace function public.set_dm_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  target_table text;
  domain_tables text[] := array[
    'dm_applications',
    'dm_source_repositories',
    'dm_pipelines',
    'dm_pipeline_runs',
    'dm_run_events',
    'dm_artifacts',
    'dm_releases',
    'dm_deployment_targets',
    'dm_environment_locks',
    'dm_release_plans',
    'dm_release_executions',
    'dm_release_events',
    'dm_approvals',
    'dm_webhook_deliveries',
    'dm_audit_events',
    'dm_environments',
    'dm_runner_pools'
  ];
begin
  foreach target_table in array domain_tables loop
    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        entity_id text not null unique,
        payload jsonb not null,
        sort_order integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint %I check (payload ? 'id')
      )
    $ddl$, target_table, target_table || '_payload_has_id');

    execute format(
      'create index if not exists %I on public.%I (sort_order)',
      target_table || '_sort_order_idx',
      target_table
    );
    execute format(
      'create index if not exists %I on public.%I (updated_at desc)',
      target_table || '_updated_at_idx',
      target_table
    );
    execute format(
      'create index if not exists %I on public.%I using gin (payload jsonb_path_ops)',
      target_table || '_payload_gin_idx',
      target_table
    );

    execute format('drop trigger if exists %I on public.%I', target_table || '_set_updated_at', target_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_dm_records_updated_at()',
      target_table || '_set_updated_at',
      target_table
    );

    execute format('alter table public.%I enable row level security', target_table);
    execute format('drop policy if exists %I on public.%I', 'service role manages ' || target_table, target_table);
    execute format(
      'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
      'service role manages ' || target_table,
      target_table
    );
    execute format('revoke all on public.%I from anon', target_table);
    execute format('revoke all on public.%I from authenticated', target_table);
    execute format('grant select, insert, update, delete on public.%I to service_role', target_table);
  end loop;
end;
$$;

create or replace function public.replace_dm_records(
  p_table text,
  p_records jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_table text;
begin
  target_table := case p_table
    when 'dm_applications' then p_table
    when 'dm_source_repositories' then p_table
    when 'dm_pipelines' then p_table
    when 'dm_pipeline_runs' then p_table
    when 'dm_run_events' then p_table
    when 'dm_artifacts' then p_table
    when 'dm_releases' then p_table
    when 'dm_deployment_targets' then p_table
    when 'dm_environment_locks' then p_table
    when 'dm_release_plans' then p_table
    when 'dm_release_executions' then p_table
    when 'dm_release_events' then p_table
    when 'dm_approvals' then p_table
    when 'dm_webhook_deliveries' then p_table
    when 'dm_audit_events' then p_table
    when 'dm_environments' then p_table
    when 'dm_runner_pools' then p_table
    else null
  end;

  if target_table is null then
    raise exception 'Unsupported Deploy Management storage table: %', p_table
      using errcode = '22023';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array'
      using errcode = '22023';
  end if;

  execute format($sql$
    with incoming as (
      select
        record.value ->> 'id' as entity_id,
        record.value as payload,
        (record.ordinality - 1)::integer as sort_order
      from jsonb_array_elements($1) with ordinality as record(value, ordinality)
    ),
    valid_incoming as (
      select *
      from incoming
      where entity_id is not null and length(trim(entity_id)) > 0
    ),
    deleted as (
      delete from public.%I existing
      where not exists (
        select 1
        from valid_incoming next_records
        where next_records.entity_id = existing.entity_id
      )
      returning existing.entity_id
    )
    insert into public.%I (entity_id, payload, sort_order)
    select entity_id, payload, sort_order
    from valid_incoming
    on conflict (entity_id)
    do update set
      payload = excluded.payload,
      sort_order = excluded.sort_order
  $sql$, target_table, target_table)
  using p_records;
end;
$$;

grant execute on function public.replace_dm_records(text, jsonb) to service_role;

-- Query indexes are intentionally domain-specific. The canonical payload stays
-- JSONB while contracts are still moving, but hot reads do not scan every row.
create index if not exists dm_applications_repository_idx
  on public.dm_applications ((payload ->> 'repositoryId'), (payload ->> 'owner'));

create index if not exists dm_source_repositories_provider_idx
  on public.dm_source_repositories ((payload ->> 'provider'), (payload ->> 'owner'));

create index if not exists dm_pipelines_application_repository_idx
  on public.dm_pipelines ((payload ->> 'applicationId'), (payload ->> 'repositoryId'), (payload ->> 'targetEnvironment'));

create index if not exists dm_pipeline_runs_pipeline_status_idx
  on public.dm_pipeline_runs ((payload ->> 'pipelineId'), (payload ->> 'status'), (payload ->> 'environment'));

create index if not exists dm_pipeline_runs_application_idx
  on public.dm_pipeline_runs ((payload ->> 'applicationId'), (payload ->> 'createdAt'));

create index if not exists dm_run_events_run_sequence_idx
  on public.dm_run_events ((payload ->> 'runId'), sort_order);

create index if not exists dm_run_events_type_idx
  on public.dm_run_events ((payload ->> 'type'), (payload ->> 'source'));

create index if not exists dm_artifacts_run_type_idx
  on public.dm_artifacts ((payload ->> 'runId'), (payload ->> 'type'));

create index if not exists dm_releases_run_environment_idx
  on public.dm_releases ((payload ->> 'runId'), (payload ->> 'environment'), (payload ->> 'status'));

create index if not exists dm_deployment_targets_environment_adapter_idx
  on public.dm_deployment_targets ((payload ->> 'environment'), (payload ->> 'adapter'));

create index if not exists dm_environment_locks_active_idx
  on public.dm_environment_locks ((payload ->> 'applicationId'), (payload ->> 'environment'), (payload ->> 'status'));

create index if not exists dm_release_plans_application_environment_idx
  on public.dm_release_plans ((payload ->> 'applicationId'), (payload ->> 'environment'), (payload ->> 'status'));

create index if not exists dm_release_executions_release_status_idx
  on public.dm_release_executions ((payload ->> 'releaseId'), (payload ->> 'status'), (payload ->> 'environment'));

create index if not exists dm_release_events_release_sequence_idx
  on public.dm_release_events ((payload ->> 'releaseId'), sort_order);

create index if not exists dm_release_events_run_idx
  on public.dm_release_events ((payload ->> 'runId'), (payload ->> 'type'));

create index if not exists dm_approvals_run_status_idx
  on public.dm_approvals ((payload ->> 'runId'), (payload ->> 'status'), (payload ->> 'environment'));

create index if not exists dm_webhook_deliveries_dedupe_idx
  on public.dm_webhook_deliveries ((payload ->> 'provider'), (payload ->> 'pipelineId'), (payload ->> 'deliveryId'));

create index if not exists dm_webhook_deliveries_expires_idx
  on public.dm_webhook_deliveries ((payload ->> 'expiresAt'));

create index if not exists dm_audit_events_actor_action_idx
  on public.dm_audit_events ((payload ->> 'actor'), (payload ->> 'action'), (payload ->> 'createdAt'));

create index if not exists dm_environments_status_idx
  on public.dm_environments ((payload ->> 'status'), (payload ->> 'activeReleaseId'));

create index if not exists dm_runner_pools_type_idx
  on public.dm_runner_pools ((payload ->> 'type'));
