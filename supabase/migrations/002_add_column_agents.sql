create table if not exists public.column_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  column_name text not null check (column_name in ('New','In Refinement','Ready','In Work','Work Completed','In Review','Review Completed','In Testing','Testing Completed','Ready for Live','Live')),
  name text not null,
  instructions text not null,
  start_mode text not null default 'manual' check (start_mode in ('manual','automatic')),
  enabled boolean not null default true,
  github_owner text not null default '',
  github_repo text not null default '',
  base_branch text not null default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, column_name)
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  column_name text not null,
  agent_name text not null,
  trigger_type text not null check (trigger_type in ('manual','automatic')),
  status text not null default 'queued' check (status in ('queued','running','awaiting_approval','completed','failed','cancelled')),
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.column_agents enable row level security;
alter table public.agent_runs enable row level security;

create policy "Users manage their own column agents" on public.column_agents for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their own agent runs" on public.agent_runs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists agent_runs_user_status_idx on public.agent_runs (user_id, status, created_at desc);
