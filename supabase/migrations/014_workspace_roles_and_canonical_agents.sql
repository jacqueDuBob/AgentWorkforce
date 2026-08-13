create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.user_roles (user_id, role)
select id, 'user' from auth.users on conflict (user_id) do nothing;

-- Bootstrap the oldest account as admin. Further role changes require an admin
-- (or the Supabase service role).
update public.user_roles set role = 'admin', updated_at = now()
where user_id = (select id from auth.users order by created_at, id limit 1)
  and not exists (select 1 from public.user_roles where role = 'admin');

create or replace function public.is_admin(candidate_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = candidate_user_id and role = 'admin');
$$;
revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

alter table public.user_roles enable row level security;
create policy "Users read their role" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "Admins create roles" on public.user_roles for insert to authenticated
  with check (public.is_admin());
create policy "Admins update roles" on public.user_roles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete roles" on public.user_roles for delete to authenticated
  using (public.is_admin());

create or replace function public.create_user_role_after_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger create_user_role_after_signup after insert on auth.users
  for each row execute function public.create_user_role_after_signup();

drop trigger if exists create_default_column_agents_after_signup on auth.users;
drop trigger if exists create_default_deployment_agent_after_signup on auth.users;

-- Keep the latest configuration for every column. Cascading foreign keys remove
-- repository permissions belonging to discarded agent copies.
delete from public.column_agents as candidate using public.column_agents as keeper
where candidate.column_name = keeper.column_name
  and (candidate.updated_at, candidate.created_at, candidate.id) < (keeper.updated_at, keeper.created_at, keeper.id);

alter table public.column_agents drop constraint if exists column_agents_user_id_column_name_key;
drop policy if exists "Users manage their own column agents" on public.column_agents;
alter table public.column_agents drop column user_id;
alter table public.column_agents add constraint column_agents_column_name_key unique (column_name);

create policy "Authenticated users read column agents" on public.column_agents
  for select to authenticated using (true);
create policy "Admins create column agents" on public.column_agents
  for insert to authenticated with check (public.is_admin());
create policy "Admins update column agents" on public.column_agents
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete column agents" on public.column_agents
  for delete to authenticated using (public.is_admin());

drop policy if exists "Users manage their own agent repository access" on public.column_agent_repositories;
alter table public.column_agent_repositories drop column user_id;
create policy "Authenticated users read agent repository access" on public.column_agent_repositories
  for select to authenticated using (true);
create policy "Admins create agent repository access" on public.column_agent_repositories
  for insert to authenticated with check (public.is_admin());
create policy "Admins delete agent repository access" on public.column_agent_repositories
  for delete to authenticated using (public.is_admin());

create trigger column_agents_set_updated_at before update on public.column_agents
  for each row execute function public.set_updated_at();
