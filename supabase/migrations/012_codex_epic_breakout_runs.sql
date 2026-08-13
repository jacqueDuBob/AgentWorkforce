alter table public.agent_runs
  add column if not exists run_kind text not null default 'column',
  add column if not exists queue_class text not null default 'background',
  add column if not exists run_input jsonb not null default '{}'::jsonb;

alter table public.agent_runs drop constraint if exists agent_runs_run_kind_check;
alter table public.agent_runs add constraint agent_runs_run_kind_check
  check (run_kind in ('column','refinement_questions','refinement_rewrite','epic_breakout'));

alter table public.agent_runs drop constraint if exists agent_runs_queue_class_check;
alter table public.agent_runs add constraint agent_runs_queue_class_check
  check (queue_class in ('background','interactive'));

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
set epic_breakout_prompt = E'You are {{agentName}}, a repository-aware Epic breakout agent for {{domain}}. Inspect the selected repository before responding. Decompose the Epic into independently actionable child tickets grounded in the existing architecture and patterns. Do not repeat the Epic, invent unrelated scope, or modify files. Each child needs concise, testable acceptance criteria. The requesting participant is {{requesterEmail}}.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nSelected repository:\n{{repository}}\n\nEpic:\n{{ticket}}'
where column_name = 'In Refinement';
