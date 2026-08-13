alter table public.agent_runs
  add column if not exists run_kind text not null default 'column'
    check (run_kind in ('column','refinement_questions','refinement_rewrite')),
  add column if not exists queue_class text not null default 'background'
    check (queue_class in ('background','interactive')),
  add column if not exists run_input jsonb not null default '{}'::jsonb;

create index if not exists agent_runs_claim_priority_idx
  on public.agent_runs (user_id, status, queue_class, created_at);

create or replace function public.claim_next_agent_run_for_worker(requested_worker_id uuid)
returns public.agent_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  worker public.local_codex_workers;
  claimed public.agent_runs;
begin
  select * into worker from public.local_codex_workers
  where id = requested_worker_id and revoked_at is null;
  if worker.id is null then return null; end if;

  select * into claimed from public.agent_runs
  where user_id = worker.user_id and status = 'queued'
  order by case when queue_class = 'interactive' then 0 else 1 end, created_at
  for update skip locked limit 1;

  if claimed.id is null then
    update public.local_codex_workers set last_seen_at = now() where id = worker.id;
    return null;
  end if;

  update public.agent_runs set status = 'in_progress', worker_id = worker.id,
    started_at = now(), updated_at = now(), error = null
  where id = claimed.id returning * into claimed;
  update public.local_codex_workers set last_seen_at = now() where id = worker.id;
  return claimed;
end;
$$;

revoke all on function public.claim_next_agent_run_for_worker(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_agent_run_for_worker(uuid) to service_role;

update public.column_agents
set refinement_questions_prompt = E'You are a repository-aware product and technical refinement agent. Inspect the selected repository before responding. Identify relevant architecture, existing patterns, likely affected files, constraints, and risks. Ask 5-10 concise questions that resolve the most important product and technical ambiguities. Each question must have exactly three short, realistic, mutually exclusive suggested answers. Do not include an "Other" suggestion because the UI supplies a free-text answer. Do not modify files.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nAgent name:\n{{agentName}}\n\nSelected repository:\n{{repository}}\n\nTicket:\n{{ticket}}',
    refinement_rewrite_prompt = E'You are a repository-aware product and technical refinement agent. Inspect the selected repository and rewrite the ticket using the user answers. Preserve valid detail, resolve ambiguity, and produce an implementation-ready technical solution design grounded in the existing code. Mention relevant files and patterns, planned changes, test strategy, constraints, and risks. Do not modify files and do not invent requirements. Acceptance criteria must be concise and testable. Return no more than three short tags. Recommend an Epic only when multiple independently deliverable child tickets, a repository or application-domain boundary, or more than one safe implementation and review cycle is required.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nAgent name:\n{{agentName}}\n\nSelected repository:\n{{repository}}\n\nAnswers:\n{{refinementAnswers}}\n\nTicket:\n{{ticket}}'
where column_name = 'In Refinement';
