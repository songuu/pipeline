-- Sprint B Task 9: Pipeline graph layout persistence (opt-in via DEPLOYMENT_STORAGE=supabase).
-- Stores UI layout (node positions, viewport) per (pipeline_id, actor). Does NOT store execution DAG —
-- execution DAG is always derived from PipelineDefinition + DEFAULT_STAGE_DAG, never from this table.

do $$
declare
  target_table text := 'dm_pipeline_graph_layouts';
begin
  execute format($ddl$
    create table if not exists public.%I (
      id uuid primary key default gen_random_uuid(),
      entity_id text not null unique,
      payload jsonb not null,
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint %I check (payload ? 'id'),
      constraint %I check (payload ? 'pipeline_id'),
      constraint %I check (payload ? 'actor')
    )
  $ddl$, target_table,
       target_table || '_payload_has_id',
       target_table || '_payload_has_pipeline_id',
       target_table || '_payload_has_actor');

  execute format(
    'create index if not exists %I on public.%I (sort_order)',
    target_table || '_sort_order_idx', target_table);
  execute format(
    'create index if not exists %I on public.%I (updated_at desc)',
    target_table || '_updated_at_idx', target_table);
  execute format(
    'create index if not exists %I on public.%I ((payload ->> ''pipeline_id''))',
    target_table || '_pipeline_id_idx', target_table);
  execute format(
    'create index if not exists %I on public.%I ((payload ->> ''actor''))',
    target_table || '_actor_idx', target_table);

  execute format('drop trigger if exists %I on public.%I', target_table || '_set_updated_at', target_table);
  execute format(
    'create trigger %I before update on public.%I for each row execute function public.set_dm_records_updated_at()',
    target_table || '_set_updated_at', target_table);

  execute format('alter table public.%I enable row level security', target_table);
  execute format('drop policy if exists %I on public.%I', 'service role manages ' || target_table, target_table);
  execute format(
    'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
    'service role manages ' || target_table, target_table);
  execute format('revoke all on public.%I from anon', target_table);
  execute format('revoke all on public.%I from authenticated', target_table);
  execute format('grant select, insert, update, delete on public.%I to service_role', target_table);
end;
$$;
