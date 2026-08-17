-- Corrections and compatibility hardening for distributed completion. Migration
-- 021 is immutable because it may already be applied.
alter table public.agent_runs add column queue_dedup_key text;
create unique index agent_runs_queue_dedup_key_idx on public.agent_runs(user_id, queue_dedup_key)
  where queue_dedup_key is not null;

create or replace function public.quarantine_invalid_job_specs_on_worker_poll()
returns trigger language plpgsql security definer set search_path='' as $$
declare candidate record; failed_attempt_id uuid;
begin
  for candidate in
    select r.id,r.attempt_count from public.agent_runs r
    where r.user_id=new.user_id and r.status='queued' and r.job_spec is not null and (
      jsonb_typeof(r.job_spec) is distinct from 'object'
      or nullif(r.job_spec#>>'{agent,provider}','') is null
      or jsonb_typeof(r.job_spec->'ticket') is distinct from 'object'
      or jsonb_typeof(r.job_spec->'permissions') is distinct from 'object'
      or jsonb_typeof(r.job_spec->'execution') is distinct from 'object'
      or jsonb_typeof(r.job_spec#>'{execution,verificationPlan}') is distinct from 'object'
      or jsonb_typeof(r.job_spec#>'{execution,verificationPlan,checks}') is distinct from 'array'
      or (r.job_spec->'repository' <> 'null'::jsonb and jsonb_typeof(r.job_spec->'repository') is distinct from 'object')
      or (jsonb_typeof(r.job_spec->'repository')='object' and (nullif(r.job_spec#>>'{repository,owner}','') is null or nullif(r.job_spec#>>'{repository,name}','') is null))
    ) for update skip locked
  loop
    insert into public.agent_run_attempts(run_id,attempt_number,worker_id,status,lease_until,finished_at,failure_class,retryable,error,completion_id,completion_payload_hash)
      values(candidate.id,candidate.attempt_count+1,new.id,'failed',now(),now(),'contract',false,'Persisted JobSpec failed structural validation.',gen_random_uuid(),'database-contract-validation')
      returning id into failed_attempt_id;
    update public.agent_runs set status='finished',attempt_count=candidate.attempt_count+1,active_attempt_id=null,worker_id=new.id,
      finished_at=now(),updated_at=now(),error='Persisted JobSpec failed structural validation.' where id=candidate.id;
  end loop;
  return new;
end; $$;

create trigger local_worker_quarantine_invalid_job_specs
before update of capabilities on public.local_codex_workers
for each row execute function public.quarantine_invalid_job_specs_on_worker_poll();
revoke all on function public.quarantine_invalid_job_specs_on_worker_poll() from public,anon,authenticated;

create or replace function public.record_agent_attempt_completion_effects()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.agent_runs; questions jsonb; proposals jsonb; thread_id text;
begin
  if old.completion_id is not null or new.completion_id is null then return new; end if;
  select * into r from public.agent_runs where id=new.run_id;
  questions := coalesce(new.canonical_result#>'{result,questions}','[]'::jsonb);
  proposals := coalesce(new.canonical_result#>'{result,proposals}','[]'::jsonb);
  thread_id := nullif(new.canonical_result#>>'{agent,threadId}','');
  if thread_id is not null then update public.agent_runs set codex_thread_id=thread_id where id=new.run_id; end if;
  if new.error is not null and new.retryable and r.attempt_count < r.max_attempts then return new; end if;
  if new.error is not null then
    perform public.notify_ticket_participants(r.ticket_id,'execution','Agent run failed',new.error);
  elsif jsonb_array_length(questions)>0 then
    perform public.notify_ticket_participants(r.ticket_id,'question','Agent question needs an answer',questions->>0);
  else
    perform public.notify_ticket_participants(r.ticket_id,'execution','Agent run completed','The agent finished processing this ticket.');
  end if;
  if jsonb_array_length(proposals)>0 then
    perform public.notify_ticket_participants(r.ticket_id,'proposal','Approval needed for a proposed update',proposals#>>'{0,title}');
  end if;
  return new;
end; $$;

create trigger agent_run_attempt_completion_effects
after update of completion_id on public.agent_run_attempts
for each row execute function public.record_agent_attempt_completion_effects();
revoke all on function public.record_agent_attempt_completion_effects() from public,anon,authenticated;
