-- Release / canary query indexes for the generic deployment_records store.
-- Run after 20260514_deployment_records.sql.

create index if not exists deployment_records_release_event_release_idx
  on public.deployment_records (collection, ((payload ->> 'releaseId')), sort_order)
  where collection = 'release-events';

create index if not exists deployment_records_release_event_run_idx
  on public.deployment_records (collection, ((payload ->> 'runId')), sort_order)
  where collection = 'release-events';

create index if not exists deployment_records_release_plan_application_env_idx
  on public.deployment_records (collection, ((payload ->> 'applicationId')), ((payload ->> 'environment')))
  where collection = 'release-plans';

create index if not exists deployment_records_release_execution_release_idx
  on public.deployment_records (collection, ((payload ->> 'releaseId')))
  where collection = 'release-executions';

create index if not exists deployment_records_release_execution_status_idx
  on public.deployment_records (collection, ((payload ->> 'status')), ((payload ->> 'environment')))
  where collection = 'release-executions';

create index if not exists deployment_records_environment_lock_active_idx
  on public.deployment_records (collection, ((payload ->> 'applicationId')), ((payload ->> 'environment')), ((payload ->> 'status')))
  where collection = 'environment-locks';

create index if not exists deployment_records_deployment_target_env_adapter_idx
  on public.deployment_records (collection, ((payload ->> 'environment')), ((payload ->> 'adapter')))
  where collection = 'deployment-targets';
