create table public.github_repositories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  owner text not null,
  name text not null,
  default_branch text not null default 'main',
  created_at timestamptz not null default now(),
  unique (user_id, owner, name)
);

alter table public.github_repositories enable row level security;
create policy "Users manage their own repositories" on public.github_repositories for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.tickets add column repository_id uuid references public.github_repositories(id) on delete set null;
alter table public.tickets add column base_branch text not null default '';
alter table public.column_agents add column repository_access text not null default 'all' check (repository_access in ('all','selected'));

create table public.column_agent_repositories (
  column_agent_id uuid not null references public.column_agents(id) on delete cascade,
  repository_id uuid not null references public.github_repositories(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  primary key (column_agent_id, repository_id)
);
alter table public.column_agent_repositories enable row level security;
create policy "Users manage their own agent repository access" on public.column_agent_repositories for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.column_agents drop column github_owner;
alter table public.column_agents drop column github_repo;
alter table public.column_agents drop column base_branch;
