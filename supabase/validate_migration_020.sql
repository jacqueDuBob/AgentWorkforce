-- Read-only validation for migration 020.
do $validation$
declare failures text[] := array[]::text[];
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agent_runs' and column_name = 'job_spec')
    then failures := array_append(failures, 'agent_runs.job_spec is missing'); end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agent_runs' and column_name = 'canonical_result')
    then failures := array_append(failures, 'agent_runs.canonical_result is missing'); end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.agent_runs'::regclass and tgname = 'agent_runs_protect_job_spec' and not tgisinternal)
    then failures := array_append(failures, 'JobSpec immutability trigger is missing'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_runs' and policyname = 'Users read their own agent runs')
    then failures := array_append(failures, 'read-only agent_runs policy is missing'); end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_runs' and cmd in ('INSERT','UPDATE','DELETE','ALL'))
    then failures := array_append(failures, 'agent_runs still has a browser mutation policy'); end if;
  if not exists (select 1 from public.column_agents where column_name = 'In Review' and instructions like '%Runner executes deterministic verification%')
    then failures := array_append(failures, 'Review prompt was not updated'); end if;
  if not exists (select 1 from public.column_agents where column_name = 'In Testing' and instructions like '%Runner is authoritative%')
    then failures := array_append(failures, 'Testing prompt was not updated'); end if;
  if cardinality(failures) > 0 then raise exception E'Migration 020 validation failed:\n- %', array_to_string(failures, E'\n- '); end if;
  raise notice 'Migration 020 validation passed.';
end
$validation$;
