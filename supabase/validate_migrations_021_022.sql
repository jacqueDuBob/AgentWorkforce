do $$
begin
  if to_regclass('public.agent_run_attempts') is null then raise exception 'agent_run_attempts is missing'; end if;
  if to_regclass('public.agent_run_outbox') is null then raise exception 'agent_run_outbox is missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='agent_runs' and column_name='active_attempt_id') then raise exception 'agent_runs.active_attempt_id is missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='agent_runs' and column_name='queue_dedup_key') then raise exception 'agent_runs.queue_dedup_key is missing'; end if;
  if to_regprocedure('public.claim_next_agent_run_for_worker(uuid,jsonb,integer)') is null then raise exception 'capability-aware claim function is missing'; end if;
  if to_regprocedure('public.heartbeat_agent_run_attempt(uuid,uuid,uuid,jsonb,integer)') is null then raise exception 'heartbeat function is missing'; end if;
  if to_regprocedure('public.finalize_agent_run_attempt(uuid,uuid,uuid,uuid,text,jsonb,text,integer,jsonb,text,boolean,jsonb,jsonb,jsonb,boolean)') is null then raise exception 'finalize function is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='local_worker_quarantine_invalid_job_specs' and not tgisinternal) then raise exception 'invalid contract quarantine trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='agent_run_attempt_completion_effects' and not tgisinternal) then raise exception 'completion effects trigger is missing'; end if;
end $$;
