-- Capability-aware claims, leased execution attempts, and idempotent finalization.
alter table public.local_codex_workers
  add column capabilities_version integer not null default 1,
  add column capabilities jsonb not null default '{"jobSpecVersions":[],"jobTypes":[],"agentAdapters":[],"workspaceProviders":[],"repositories":[],"features":["legacy_jobs"]}'::jsonb;

alter table public.agent_runs
  add column active_attempt_id uuid,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column max_attempts integer not null default 3 check (max_attempts between 1 and 20);

create table public.agent_run_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  worker_id uuid not null references public.local_codex_workers(id) on delete restrict,
  status text not null default 'in_progress' check (status in ('in_progress','succeeded','failed','expired','cancelled')),
  lease_until timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  progress jsonb,
  failure_class text check (failure_class is null or failure_class in ('contract','configuration','permission','provider','verification','infrastructure','timeout','cancellation')),
  retryable boolean not null default false,
  error text,
  result_version integer,
  canonical_result jsonb,
  completion_id uuid,
  completion_payload_hash text,
  unique (run_id, attempt_number),
  unique (completion_id)
);

alter table public.agent_runs add constraint agent_runs_active_attempt_fk
  foreign key (active_attempt_id) references public.agent_run_attempts(id) on delete set null;
create index agent_run_attempts_lease_idx on public.agent_run_attempts(status, lease_until);
create index agent_run_attempts_run_idx on public.agent_run_attempts(run_id, attempt_number desc);
alter table public.agent_run_attempts enable row level security;
create policy "Users read attempts for their runs" on public.agent_run_attempts for select to authenticated
  using (exists (select 1 from public.agent_runs r where r.id = run_id and r.user_id = auth.uid()));

create table public.agent_run_outbox (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  attempt_id uuid not null references public.agent_run_attempts(id) on delete cascade,
  event_type text not null check (event_type in ('queue_deployment')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  unique (attempt_id, event_type)
);
alter table public.agent_run_outbox enable row level security;

create or replace function public.claim_next_agent_run_for_worker(requested_worker_id uuid, advertised_capabilities jsonb default null, requested_lease_seconds integer default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare worker public.local_codex_workers; claimed public.agent_runs; attempt public.agent_run_attempts; caps jsonb;
begin
  if requested_lease_seconds not between 30 and 600 then raise exception 'Invalid lease duration'; end if;
  select * into worker from public.local_codex_workers where id = requested_worker_id and revoked_at is null for update;
  if worker.id is null then return null; end if;
  caps := coalesce(advertised_capabilities, worker.capabilities);
  if jsonb_typeof(caps) <> 'object' then raise exception 'Invalid worker capabilities'; end if;
  update public.local_codex_workers set capabilities = caps, capabilities_version = 1, last_seen_at = now() where id = worker.id;

  update public.agent_run_attempts a set status='expired', finished_at=now(), failure_class='infrastructure', retryable=true,
    error='Execution lease expired.' where a.status='in_progress' and a.lease_until <= now();
  update public.agent_runs r set status=case when r.attempt_count < r.max_attempts then 'queued' else 'finished' end,
    active_attempt_id=null, worker_id=null, error=case when r.attempt_count < r.max_attempts then null else 'Maximum execution attempts exhausted after lease expiry.' end,
    finished_at=case when r.attempt_count < r.max_attempts then null else now() end, updated_at=now()
    where r.status='in_progress' and r.active_attempt_id in (select a.id from public.agent_run_attempts a where a.status='expired');

  select r.* into claimed from public.agent_runs r where r.user_id=worker.user_id and r.status='queued' and (
    (r.job_spec is null and caps->'features' ? 'legacy_jobs') or
    (r.job_spec is not null
      and caps->'jobSpecVersions' @> jsonb_build_array(r.job_spec_version)
      and caps->'jobTypes' @> jsonb_build_array(r.job_type)
      and caps->'agentAdapters' @> jsonb_build_array(r.job_spec#>>'{agent,provider}')
      and caps->'workspaceProviders' ? 'local_checkout'
      and (r.job_spec->'repository' = 'null'::jsonb or caps->'repositories' @> jsonb_build_array(concat(r.job_spec#>>'{repository,owner}','/',r.job_spec#>>'{repository,name}')))
      and (jsonb_array_length(r.job_spec#>'{execution,verificationPlan,checks}')=0 or caps->'features' ? 'deterministic_verification')))
    order by case when r.run_kind in ('refinement_questions','refinement_rewrite') then 0 else 1 end, r.created_at
    for update skip locked limit 1;
  if claimed.id is null then return null; end if;
  insert into public.agent_run_attempts(run_id,attempt_number,worker_id,lease_until)
    values(claimed.id,claimed.attempt_count+1,worker.id,now()+make_interval(secs=>requested_lease_seconds)) returning * into attempt;
  update public.agent_runs set status='in_progress',worker_id=worker.id,active_attempt_id=attempt.id,attempt_count=attempt.attempt_number,
    started_at=coalesce(started_at,now()),finished_at=null,updated_at=now(),error=null where id=claimed.id returning * into claimed;
  return jsonb_build_object('run',to_jsonb(claimed),'attempt',to_jsonb(attempt));
end; $$;

create or replace function public.heartbeat_agent_run_attempt(requested_worker_id uuid, requested_run_id uuid, requested_attempt_id uuid, requested_progress jsonb default null, requested_lease_seconds integer default 90)
returns public.agent_run_attempts language plpgsql security definer set search_path='' as $$
declare touched public.agent_run_attempts;
begin
  update public.agent_run_attempts a set heartbeat_at=now(),lease_until=now()+make_interval(secs=>requested_lease_seconds),progress=requested_progress
    where a.id=requested_attempt_id and a.run_id=requested_run_id and a.worker_id=requested_worker_id and a.status='in_progress' and a.lease_until>now()
      and exists(select 1 from public.agent_runs r where r.id=requested_run_id and r.active_attempt_id=a.id and r.status='in_progress') returning * into touched;
  return touched;
end; $$;

create or replace function public.finalize_agent_run_attempt(requested_worker_id uuid, requested_run_id uuid, requested_attempt_id uuid,
  requested_completion_id uuid, requested_payload_hash text, requested_output jsonb, requested_error text, requested_result_version integer,
  requested_canonical_result jsonb, requested_failure_class text, requested_retryable boolean, requested_questions jsonb,
  requested_proposals jsonb, requested_findings jsonb, requested_queue_deployment boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.agent_run_attempts; r public.agent_runs; waiting boolean; will_retry boolean;
begin
  select * into a from public.agent_run_attempts where id=requested_attempt_id and run_id=requested_run_id for update;
  if a.id is null or a.worker_id<>requested_worker_id then return jsonb_build_object('state','stale'); end if;
  if a.completion_id is not null then
    if a.completion_id=requested_completion_id and a.completion_payload_hash=requested_payload_hash then return jsonb_build_object('state','duplicate','status',a.status); end if;
    return jsonb_build_object('state','conflict');
  end if;
  select * into r from public.agent_runs where id=requested_run_id and active_attempt_id=a.id for update;
  if r.id is null or a.status<>'in_progress' or a.lease_until<=now() then return jsonb_build_object('state','stale'); end if;
  waiting := requested_error is null and jsonb_array_length(coalesce(requested_questions,'[]'::jsonb))>0;
  will_retry := requested_error is not null and requested_retryable and r.attempt_count<r.max_attempts;
  update public.agent_run_attempts set status=case when requested_error is null then 'succeeded' else 'failed' end,finished_at=now(),
    failure_class=requested_failure_class,retryable=requested_retryable,error=requested_error,result_version=requested_result_version,
    canonical_result=requested_canonical_result,completion_id=requested_completion_id,completion_payload_hash=requested_payload_hash where id=a.id;
  if not will_retry then
    insert into public.agent_questions(ticket_id,run_id,question) select r.ticket_id,r.id,value#>>'{}' from jsonb_array_elements(coalesce(requested_questions,'[]'));
    insert into public.ticket_proposals(ticket_id,run_id,title,description,changes) select r.ticket_id,r.id,x->>'title',coalesce(x->>'description',''),coalesce(x->'changes','{}') from jsonb_array_elements(coalesce(requested_proposals,'[]')) x;
    if requested_findings is not null then update public.tickets set findings=(select string_agg('- '||(value#>>'{}'),E'\n') from jsonb_array_elements(requested_findings)),updated_at=now() where id=r.ticket_id and user_id=r.user_id; end if;
    if requested_queue_deployment then insert into public.agent_run_outbox(run_id,attempt_id,event_type,payload) values(r.id,a.id,'queue_deployment',jsonb_build_object('userId',r.user_id,'ticketId',r.ticket_id)) on conflict do nothing; end if;
  end if;
  update public.agent_runs set status=case when will_retry then 'queued' when waiting then 'waiting_for_answer' else 'finished' end,
    active_attempt_id=null,worker_id=case when will_retry then null else worker_id end,finished_at=case when will_retry or waiting then null else now() end,
    updated_at=now(),output=case when will_retry then output else coalesce(requested_output,output) end,error=case when will_retry then null else requested_error end,
    result_version=case when will_retry then result_version else requested_result_version end,canonical_result=case when will_retry then canonical_result else requested_canonical_result end where id=r.id;
  return jsonb_build_object('state','applied','retrying',will_retry,'waiting',waiting);
end; $$;

revoke all on function public.claim_next_agent_run_for_worker(uuid,jsonb,integer), public.heartbeat_agent_run_attempt(uuid,uuid,uuid,jsonb,integer), public.finalize_agent_run_attempt(uuid,uuid,uuid,uuid,text,jsonb,text,integer,jsonb,text,boolean,jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.claim_next_agent_run_for_worker(uuid,jsonb,integer), public.heartbeat_agent_run_attempt(uuid,uuid,uuid,jsonb,integer), public.finalize_agent_run_attempt(uuid,uuid,uuid,uuid,text,jsonb,text,integer,jsonb,text,boolean,jsonb,jsonb,jsonb,boolean) to service_role;
