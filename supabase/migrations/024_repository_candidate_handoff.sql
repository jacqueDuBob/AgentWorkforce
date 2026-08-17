-- Durable Git-native candidate handoff between disposable execution attempts.
create table public.repository_candidates (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  repository_id uuid not null references public.github_repositories(id) on delete cascade,
  source_job_id uuid not null references public.agent_runs(id) on delete cascade,
  source_attempt_id uuid not null references public.agent_run_attempts(id) on delete restrict,
  predecessor_candidate_id uuid references public.repository_candidates(id) on delete restrict,
  candidate_version integer not null check(candidate_version>0),
  branch text not null,
  base_ref text not null,
  base_sha text not null check(base_sha ~ '^[0-9a-f]{40,64}$'),
  candidate_sha text not null check(candidate_sha ~ '^[0-9a-f]{40,64}$'),
  changed_files jsonb not null check(jsonb_typeof(changed_files)='array'),
  published boolean not null,
  remote_ref text,
  created_at timestamptz not null default now(),
  unique(source_attempt_id), unique(ticket_id,repository_id,candidate_version)
);

create table public.repository_candidate_heads (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  repository_id uuid not null references public.github_repositories(id) on delete cascade,
  candidate_id uuid not null references public.repository_candidates(id) on delete restrict,
  version integer not null check(version>0),
  updated_at timestamptz not null default now(),
  primary key(ticket_id,repository_id)
);

create or replace function public.protect_repository_candidate_evidence()
returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Repository candidate evidence is immutable'; end; $$;
create trigger repository_candidates_immutable before update on public.repository_candidates
for each row execute function public.protect_repository_candidate_evidence();
revoke all on function public.protect_repository_candidate_evidence() from public,anon,authenticated;

alter table public.agent_run_attempts add column repository_candidate_id uuid references public.repository_candidates(id) on delete restrict;
alter table public.repository_candidates enable row level security;
alter table public.repository_candidate_heads enable row level security;
create policy "Participants read repository candidates" on public.repository_candidates for select to authenticated using(public.can_access_ticket(ticket_id));
create policy "Participants read repository candidate heads" on public.repository_candidate_heads for select to authenticated using(public.can_access_ticket(ticket_id));

create or replace function public.assign_repository_candidate_to_attempt(requested_worker_id uuid,requested_run_id uuid,requested_attempt_id uuid)
returns public.repository_candidates language plpgsql security definer set search_path='' as $$
declare a public.agent_run_attempts; r public.agent_runs; candidate public.repository_candidates;
begin
  select * into a from public.agent_run_attempts where id=requested_attempt_id and run_id=requested_run_id and worker_id=requested_worker_id and status='in_progress' and lease_until>now() for update;
  if a.id is null then return null; end if;
  select * into r from public.agent_runs where id=requested_run_id and active_attempt_id=a.id;
  if r.id is null then return null; end if;
  if a.repository_candidate_id is not null then select * into candidate from public.repository_candidates where id=a.repository_candidate_id; return candidate; end if;
  select c.* into candidate from public.repository_candidate_heads h join public.repository_candidates c on c.id=h.candidate_id
    where h.ticket_id=r.ticket_id and h.repository_id=(r.job_spec#>>'{repository,id}')::uuid;
  if candidate.id is not null then update public.agent_run_attempts set repository_candidate_id=candidate.id where id=a.id; end if;
  return candidate;
end; $$;

create or replace function public.publish_repository_candidate(requested_worker_id uuid,requested_run_id uuid,requested_attempt_id uuid,requested_candidate jsonb)
returns public.repository_candidates language plpgsql security definer set search_path='' as $$
declare a public.agent_run_attempts; r public.agent_runs; head public.repository_candidate_heads; prior public.repository_candidates; existing public.repository_candidates; created public.repository_candidates; repository_id uuid; predecessor uuid; next_version integer; expected_branch text; expected_base_ref text;
begin
  select * into a from public.agent_run_attempts where id=requested_attempt_id and run_id=requested_run_id and worker_id=requested_worker_id and status='in_progress' and lease_until>now() for update;
  if a.id is null then raise exception 'Stale candidate publication attempt'; end if;
  select * into r from public.agent_runs where id=requested_run_id and active_attempt_id=a.id and job_type='development' for update;
  if r.id is null then raise exception 'Only an active Development attempt may publish a candidate'; end if;
  select * into existing from public.repository_candidates where source_attempt_id=a.id;
  if existing.id is not null then
    if existing.candidate_sha=requested_candidate->>'candidateSha' then return existing; end if;
    raise exception 'Attempt already published a different candidate';
  end if;
  repository_id := (r.job_spec#>>'{repository,id}')::uuid; predecessor := nullif(requested_candidate->>'predecessorCandidateId','')::uuid;
  expected_branch := 'flowboard/'||r.ticket_id::text;
  if predecessor is not null then select * into prior from public.repository_candidates where id=predecessor and ticket_id=r.ticket_id and repository_id=repository_id; end if;
  expected_base_ref := coalesce(prior.base_ref,nullif(r.job_spec#>>'{ticket,baseBranch}',''),r.job_spec#>>'{repository,defaultBranch}');
  if requested_candidate->>'repositoryId' is distinct from repository_id::text or requested_candidate->>'sourceJobId' is distinct from r.id::text
    or requested_candidate->>'sourceAttemptId' is distinct from a.id::text or requested_candidate->>'published' is distinct from 'true' then raise exception 'Candidate evidence does not match the active attempt'; end if;
  if requested_candidate->>'branch' is distinct from expected_branch or requested_candidate->>'remoteRef' is distinct from 'refs/heads/'||expected_branch
    or requested_candidate->>'baseRef' is distinct from expected_base_ref or jsonb_typeof(requested_candidate->'changedFiles') is distinct from 'array'
    or (prior.id is not null and requested_candidate->>'baseSha' is distinct from prior.base_sha) then raise exception 'Candidate Git policy is invalid'; end if;
  select * into head from public.repository_candidate_heads where ticket_id=r.ticket_id and repository_id=repository_id for update;
  if head.candidate_id is distinct from predecessor then raise exception 'Stale candidate predecessor'; end if;
  if a.repository_candidate_id is distinct from predecessor then raise exception 'Attempt was not based on the current candidate'; end if;
  next_version := coalesce(head.version,0)+1;
  insert into public.repository_candidates(ticket_id,repository_id,source_job_id,source_attempt_id,predecessor_candidate_id,candidate_version,branch,base_ref,base_sha,candidate_sha,changed_files,published,remote_ref)
    values(r.ticket_id,repository_id,r.id,a.id,predecessor,next_version,requested_candidate->>'branch',requested_candidate->>'baseRef',requested_candidate->>'baseSha',requested_candidate->>'candidateSha',requested_candidate->'changedFiles',true,requested_candidate->>'remoteRef') returning * into created;
  insert into public.repository_candidate_heads(ticket_id,repository_id,candidate_id,version) values(r.ticket_id,repository_id,created.id,next_version)
    on conflict(ticket_id,repository_id) do update set candidate_id=excluded.candidate_id,version=excluded.version,updated_at=now()
    where public.repository_candidate_heads.candidate_id is not distinct from predecessor;
  if not found then raise exception 'Candidate head changed concurrently'; end if;
  update public.agent_run_attempts set repository_candidate_id=created.id where id=a.id;
  return created;
end; $$;

revoke all on function public.assign_repository_candidate_to_attempt(uuid,uuid,uuid),public.publish_repository_candidate(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.assign_repository_candidate_to_attempt(uuid,uuid,uuid),public.publish_repository_candidate(uuid,uuid,uuid,jsonb) to service_role;
