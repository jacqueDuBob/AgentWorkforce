do $$ begin
  if to_regclass('public.repository_candidates') is null then raise exception 'repository_candidates missing'; end if;
  if to_regclass('public.repository_candidate_heads') is null then raise exception 'repository_candidate_heads missing'; end if;
  if to_regprocedure('public.publish_repository_candidate(uuid,uuid,uuid,jsonb)') is null then raise exception 'candidate publication RPC missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_run_attempts' and column_name='repository_candidate_id') then raise exception 'attempt candidate binding missing'; end if;
end $$;
