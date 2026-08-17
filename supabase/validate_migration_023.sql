do $$
begin
  if to_regclass('public.human_input_requests') is null then raise exception 'human_input_requests is missing'; end if;
  if to_regclass('public.human_input_answer_events') is null then raise exception 'human_input_answer_events is missing'; end if;
  if to_regclass('public.agent_run_continuations') is null then raise exception 'agent_run_continuations is missing'; end if;
  if to_regprocedure('public.submit_human_input(uuid,uuid,jsonb)') is null then raise exception 'submit_human_input is missing'; end if;
  if not exists(select 1 from pg_trigger where tgname='human_input_answer_events_immutable' and not tgisinternal) then raise exception 'answer immutability trigger is missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_runs' and column_name='interaction_rounds') then raise exception 'interaction round fields are missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_runs' and column_name='logical_outcome') then raise exception 'logical outcome is missing'; end if;
end $$;
