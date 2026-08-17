-- First-class suspended execution and immutable human-input history.
alter table public.agent_runs drop constraint if exists agent_runs_status_check;
alter table public.agent_runs add constraint agent_runs_status_check check (status in (
  'queued','in_progress','waiting_for_answer','waiting_for_input','resumable','blocked','finished'
));
alter table public.agent_runs
  add column interaction_rounds integer not null default 0 check (interaction_rounds >= 0),
  add column max_interaction_rounds integer not null default 3 check (max_interaction_rounds between 1 and 20),
  add column logical_outcome text check (logical_outcome is null or logical_outcome in ('waiting_for_input','blocked','succeeded','failed','cancelled'));

create or replace function public.derive_agent_run_logical_outcome()
returns trigger language plpgsql set search_path='' as $$
begin
  new.logical_outcome := case when new.status='waiting_for_input' then 'waiting_for_input' when new.status='blocked' then 'blocked'
    when new.status='finished' and new.logical_outcome='cancelled' then 'cancelled'
    when new.status='finished' and new.error is not null then 'failed' when new.status='finished' then 'succeeded' else null end;
  return new;
end; $$;
create trigger agent_runs_derive_logical_outcome before insert or update of status,error,logical_outcome on public.agent_runs
for each row execute function public.derive_agent_run_logical_outcome();
revoke all on function public.derive_agent_run_logical_outcome() from public,anon,authenticated;

alter table public.agent_run_attempts drop constraint if exists agent_run_attempts_status_check;
alter table public.agent_run_attempts add constraint agent_run_attempts_status_check
  check (status in ('in_progress','needs_input','succeeded','failed','expired','cancelled'));

create table public.human_input_requests (
  id uuid primary key,
  version integer not null default 1 check (version=1),
  job_id uuid not null references public.agent_runs(id) on delete cascade,
  attempt_id uuid not null references public.agent_run_attempts(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  questions jsonb not null check (jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and 10),
  status text not null default 'active' check (status in ('active','answered','blocked','cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(job_id,round_number), unique(attempt_id)
);

create table public.human_input_answer_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.human_input_requests(id) on delete cascade,
  job_id uuid not null references public.agent_runs(id) on delete cascade,
  originating_attempt_id uuid not null references public.agent_run_attempts(id) on delete cascade,
  submission_key uuid not null,
  answered_by uuid not null references auth.users(id) on delete restrict,
  answers jsonb not null check (jsonb_typeof(answers)='array' and jsonb_array_length(answers)>0),
  created_at timestamptz not null default now(),
  unique(request_id,submission_key), unique(request_id)
);

create table public.agent_run_continuations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.agent_runs(id) on delete cascade,
  request_id uuid not null references public.human_input_requests(id) on delete cascade unique,
  answer_event_id uuid not null references public.human_input_answer_events(id) on delete cascade unique,
  context_version integer not null default 1 check (context_version=1),
  context jsonb not null,
  claimed_attempt_id uuid references public.agent_run_attempts(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.protect_human_input_answer_event()
returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Human input answer events are immutable'; end; $$;
create trigger human_input_answer_events_immutable before update on public.human_input_answer_events
for each row execute function public.protect_human_input_answer_event();
revoke all on function public.protect_human_input_answer_event() from public,anon,authenticated;

alter table public.human_input_requests enable row level security;
alter table public.human_input_answer_events enable row level security;
alter table public.agent_run_continuations enable row level security;
create policy "Participants read human input requests" on public.human_input_requests for select to authenticated using (public.can_access_ticket((select r.ticket_id from public.agent_runs r where r.id=job_id)));
create policy "Participants read human input answers" on public.human_input_answer_events for select to authenticated using (public.can_access_ticket((select r.ticket_id from public.agent_runs r where r.id=job_id)));
create policy "Participants read continuation history" on public.agent_run_continuations for select to authenticated using (public.can_access_ticket((select r.ticket_id from public.agent_runs r where r.id=job_id)));

alter table public.agent_questions
  add column input_request_id uuid references public.human_input_requests(id) on delete cascade,
  add column stable_question_id text,
  add column question_type text check (question_type is null or question_type in ('text','yes_no','single_choice')),
  add column options jsonb;

create or replace function public.finalize_agent_run_attempt(requested_worker_id uuid, requested_run_id uuid, requested_attempt_id uuid,
  requested_completion_id uuid, requested_payload_hash text, requested_output jsonb, requested_error text, requested_result_version integer,
  requested_canonical_result jsonb, requested_failure_class text, requested_retryable boolean, requested_questions jsonb,
  requested_proposals jsonb, requested_findings jsonb, requested_queue_deployment boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.agent_run_attempts; r public.agent_runs; needs_input boolean; blocked boolean; will_retry boolean; request_id uuid;
begin
  select * into a from public.agent_run_attempts where id=requested_attempt_id and run_id=requested_run_id for update;
  if a.id is null or a.worker_id<>requested_worker_id then return jsonb_build_object('state','stale'); end if;
  if a.completion_id is not null then
    if a.completion_id=requested_completion_id and a.completion_payload_hash=requested_payload_hash then return jsonb_build_object('state','duplicate','status',a.status); end if;
    return jsonb_build_object('state','conflict');
  end if;
  select * into r from public.agent_runs where id=requested_run_id and active_attempt_id=a.id for update;
  if r.id is null or a.status<>'in_progress' or a.lease_until<=now() then return jsonb_build_object('state','stale'); end if;
  needs_input := requested_error is null and requested_canonical_result->>'outcome'='needs_input';
  if needs_input and (jsonb_typeof(requested_questions) is distinct from 'object' or requested_questions->>'version' is distinct from '1'
    or requested_questions->>'jobId' is distinct from r.id::text or requested_questions->>'attemptId' is distinct from a.id::text
    or jsonb_typeof(requested_questions->'questions') is distinct from 'array' or coalesce(jsonb_array_length(requested_questions->'questions'),0)=0) then raise exception 'Invalid HumanInputRequest V1'; end if;
  blocked := needs_input and r.interaction_rounds+1 > r.max_interaction_rounds;
  will_retry := requested_error is not null and requested_retryable and r.attempt_count<r.max_attempts;
  update public.agent_run_attempts set status=case when needs_input then 'needs_input' when requested_error is null then 'succeeded' else 'failed' end,
    finished_at=now(),failure_class=requested_failure_class,retryable=requested_retryable,error=requested_error,result_version=requested_result_version,
    canonical_result=requested_canonical_result,completion_id=requested_completion_id,completion_payload_hash=requested_payload_hash where id=a.id;
  if needs_input then
    request_id := (requested_questions->>'requestId')::uuid;
    insert into public.human_input_requests(id,version,job_id,attempt_id,round_number,questions,status,created_at)
      values(request_id,1,r.id,a.id,r.interaction_rounds+1,requested_questions->'questions',case when blocked then 'blocked' else 'active' end,
        coalesce((requested_questions->>'createdAt')::timestamptz,now()));
    insert into public.agent_questions(ticket_id,run_id,question,input_request_id,stable_question_id,question_type,options)
      select r.ticket_id,r.id,q->>'prompt',request_id,q->>'id',q->>'type',coalesce(q->'options','[]'::jsonb) from jsonb_array_elements(requested_questions->'questions') q;
  elsif not will_retry then
    insert into public.ticket_proposals(ticket_id,run_id,title,description,changes) select r.ticket_id,r.id,x->>'title',coalesce(x->>'description',''),coalesce(x->'changes','{}') from jsonb_array_elements(coalesce(requested_proposals,'[]')) x;
    if requested_findings is not null then update public.tickets set findings=(select string_agg('- '||(value#>>'{}'),E'\n') from jsonb_array_elements(requested_findings)),updated_at=now() where id=r.ticket_id and user_id=r.user_id; end if;
    if requested_queue_deployment then insert into public.agent_run_outbox(run_id,attempt_id,event_type,payload) values(r.id,a.id,'queue_deployment',jsonb_build_object('userId',r.user_id,'ticketId',r.ticket_id)) on conflict do nothing; end if;
  end if;
  update public.agent_runs set status=case when will_retry then 'queued' when blocked then 'blocked' when needs_input then 'waiting_for_input' else 'finished' end,
    interaction_rounds=interaction_rounds+case when needs_input then 1 else 0 end,active_attempt_id=null,
    worker_id=case when will_retry then null else worker_id end,finished_at=case when will_retry or needs_input then null else now() end,updated_at=now(),
    output=case when will_retry then output else coalesce(requested_output,output) end,error=case when blocked then 'Maximum human-input rounds exceeded.' when will_retry then null else requested_error end,
    logical_outcome=case when requested_failure_class='cancellation' then 'cancelled' else logical_outcome end,
    result_version=case when will_retry then result_version else requested_result_version end,canonical_result=case when will_retry then canonical_result else requested_canonical_result end where id=r.id;
  return jsonb_build_object('state','applied','retrying',will_retry,'needsInput',needs_input,'blocked',blocked,'requestId',request_id);
end; $$;

create or replace function public.submit_human_input(requested_request_id uuid, requested_submission_key uuid, requested_answers jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.human_input_requests; r public.agent_runs; existing public.human_input_answer_events; event public.human_input_answer_events; expected_ids text[]; supplied_ids text[]; continuation jsonb;
begin
  select * into req from public.human_input_requests where id=requested_request_id for update;
  if req.id is null then raise exception 'Human input request not found'; end if;
  select * into r from public.agent_runs where id=req.job_id for update;
  if not public.can_access_ticket(r.ticket_id) then raise exception 'Not authorized'; end if;
  select * into existing from public.human_input_answer_events where request_id=requested_request_id and submission_key=requested_submission_key;
  if existing.id is not null then return jsonb_build_object('state','duplicate','answerEventId',existing.id,'jobId',existing.job_id); end if;
  if req.status<>'active' or r.status<>'waiting_for_input' then raise exception 'Human input request is no longer active'; end if;
  if jsonb_typeof(requested_answers)<>'array' then raise exception 'Answers must be an array'; end if;
  select array_agg(q->>'id' order by q->>'id') into expected_ids from jsonb_array_elements(req.questions) q;
  select array_agg(a->>'questionId' order by a->>'questionId') into supplied_ids from jsonb_array_elements(requested_answers) a where nullif(a->>'answer','') is not null;
  if expected_ids is distinct from supplied_ids then raise exception 'Answers must match every requested question exactly'; end if;
  if exists(select 1 from jsonb_array_elements(req.questions) q join jsonb_array_elements(requested_answers) a on a->>'questionId'=q->>'id'
    where jsonb_typeof(a->'answer')<>'string' or (q->>'type'='yes_no' and a->>'answer' not in ('Yes','No'))
      or (q->>'type'='single_choice' and not (q->'options' ? (a->>'answer')))) then raise exception 'An answer does not match its question type'; end if;
  insert into public.human_input_answer_events(request_id,job_id,originating_attempt_id,submission_key,answered_by,answers)
    values(req.id,r.id,req.attempt_id,requested_submission_key,auth.uid(),requested_answers) returning * into event;
  continuation := jsonb_build_object('version',1,'jobId',r.id,'requestId',req.id,'originatingAttemptId',req.attempt_id,'round',req.round_number,
    'previousContinuations',coalesce((select jsonb_agg(c.context order by c.created_at) from public.agent_run_continuations c where c.job_id=r.id),'[]'::jsonb),
    'priorResult',(select a.canonical_result from public.agent_run_attempts a where a.id=req.attempt_id),
    'request',jsonb_build_object('version',1,'requestId',req.id,'jobId',r.id,'attemptId',req.attempt_id,'questions',req.questions,'createdAt',req.created_at),
    'answers',requested_answers,'answerEvent',jsonb_build_object('id',event.id,'answeredBy',event.answered_by,'createdAt',event.created_at),
    'providerSession',(select case when a.canonical_result#>>'{agent,threadId}' is null then null else jsonb_build_object('provider',a.canonical_result#>>'{agent,provider}','sessionId',a.canonical_result#>>'{agent,threadId}') end from public.agent_run_attempts a where a.id=req.attempt_id));
  insert into public.agent_run_continuations(job_id,request_id,answer_event_id,context) values(r.id,req.id,event.id,continuation);
  update public.human_input_requests set status='answered',resolved_at=now() where id=req.id;
  update public.agent_questions q set status='resolved',answer=(select a->>'answer' from jsonb_array_elements(requested_answers) a where a->>'questionId'=q.stable_question_id),resolved_at=now()
    where q.input_request_id=req.id;
  update public.agent_runs set status='resumable',worker_id=null,started_at=null,finished_at=null,updated_at=now() where id=r.id;
  return jsonb_build_object('state','resumable','answerEventId',event.id,'jobId',r.id);
end; $$;

create or replace function public.prepare_resumable_jobs_on_worker_poll()
returns trigger language plpgsql security definer set search_path='' as $$
begin update public.agent_runs set status='queued',updated_at=now() where user_id=new.user_id and status='resumable'; return new; end; $$;
create trigger a_prepare_resumable_jobs before update of capabilities on public.local_codex_workers for each row execute function public.prepare_resumable_jobs_on_worker_poll();

create or replace function public.release_continuation_after_expired_attempt()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='expired' and old.status='in_progress' then update public.agent_run_continuations set claimed_attempt_id=null where claimed_attempt_id=new.id; end if;
  return new;
end; $$;
create trigger agent_attempt_release_expired_continuation after update of status on public.agent_run_attempts
for each row execute function public.release_continuation_after_expired_attempt();

create or replace function public.record_agent_attempt_completion_effects()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.agent_runs; questions jsonb; proposals jsonb; thread_id text;
begin
  if old.completion_id is not null or new.completion_id is null then return new; end if;
  select * into r from public.agent_runs where id=new.run_id;
  questions := coalesce(new.canonical_result#>'{result,questions}','[]'::jsonb); proposals := coalesce(new.canonical_result#>'{result,proposals}','[]'::jsonb);
  thread_id := nullif(new.canonical_result#>>'{agent,threadId}','');
  if thread_id is not null then update public.agent_runs set codex_thread_id=thread_id where id=new.run_id; end if;
  if new.error is not null and new.retryable and r.attempt_count<r.max_attempts then return new; end if;
  if new.error is not null then perform public.notify_ticket_participants(r.ticket_id,'execution','Agent run failed',new.error);
  elsif new.canonical_result->>'outcome'='needs_input' then perform public.notify_ticket_participants(r.ticket_id,'question','Agent question needs an answer',questions->>0); return new;
  else perform public.notify_ticket_participants(r.ticket_id,'execution','Agent run completed','The agent finished processing this ticket.'); end if;
  if jsonb_array_length(proposals)>0 then perform public.notify_ticket_participants(r.ticket_id,'proposal','Approval needed for a proposed update',proposals#>>'{0,title}'); end if;
  return new;
end; $$;

revoke all on function public.submit_human_input(uuid,uuid,jsonb), public.prepare_resumable_jobs_on_worker_poll(), public.release_continuation_after_expired_attempt() from public,anon,authenticated;
grant execute on function public.submit_human_input(uuid,uuid,jsonb) to authenticated;
