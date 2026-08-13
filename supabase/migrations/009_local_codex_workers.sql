create table public.local_codex_workers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.local_codex_workers enable row level security;

create policy "Users can read their own local workers"
  on public.local_codex_workers for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can revoke their own local workers"
  on public.local_codex_workers for delete to authenticated
  using (auth.uid() = user_id);

alter table public.agent_runs
  add column if not exists worker_id uuid references public.local_codex_workers(id) on delete set null,
  add column if not exists codex_thread_id text,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

create index local_codex_workers_user_idx on public.local_codex_workers (user_id, created_at desc);
create index agent_runs_worker_idx on public.agent_runs (worker_id, status, updated_at);

-- Called only by the Vercel server with its service-role client. The row lock makes
-- claiming safe even when more than one local worker is polling simultaneously.
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
  select * into worker
  from public.local_codex_workers
  where id = requested_worker_id and revoked_at is null;

  if worker.id is null then
    return null;
  end if;

  select * into claimed
  from public.agent_runs
  where user_id = worker.user_id and status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then
    update public.local_codex_workers set last_seen_at = now() where id = worker.id;
    return null;
  end if;

  update public.agent_runs
  set status = 'in_progress', worker_id = worker.id, started_at = now(),
      updated_at = now(), error = null
  where id = claimed.id
  returning * into claimed;

  update public.local_codex_workers set last_seen_at = now() where id = worker.id;
  return claimed;
end;
$$;

revoke all on function public.claim_next_agent_run_for_worker(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_agent_run_for_worker(uuid) to service_role;
