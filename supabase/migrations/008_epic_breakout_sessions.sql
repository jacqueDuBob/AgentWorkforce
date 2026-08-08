alter table public.tickets
  add column if not exists item_type text not null default 'Item' check (item_type in ('Item', 'Epic')),
  add column if not exists parent_epic_id uuid references public.tickets(id) on delete set null,
  add column if not exists is_draft boolean not null default false;

create index if not exists tickets_parent_epic_idx on public.tickets (parent_epic_id);

create table public.epic_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  reason text not null,
  recommended_by text not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  created_at timestamptz not null default now()
);

create unique index epic_recommendations_one_pending_idx on public.epic_recommendations (ticket_id) where status = 'pending';

create table public.epic_breakout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  epic_id uuid not null references public.tickets(id) on delete cascade,
  requester_user_id uuid not null default auth.uid(),
  requester_email text not null,
  agent_name text not null,
  model_name text not null,
  domain text not null,
  status text not null default 'active' check (status in ('active', 'completed', 'inactive')),
  failed_children jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- This partial unique index is the concurrency-safe single-active-session guard.
create unique index epic_breakout_sessions_one_active_idx on public.epic_breakout_sessions (epic_id) where status = 'active';
create index epic_breakout_sessions_history_idx on public.epic_breakout_sessions (epic_id, created_at desc);

alter table public.epic_recommendations enable row level security;
alter table public.epic_breakout_sessions enable row level security;
create policy "Users manage their own Epic recommendations" on public.epic_recommendations for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their own breakout sessions" on public.epic_breakout_sessions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Confirmation is atomic: the original ticket row is updated in place and the session is created together.
create or replace function public.confirm_epic_candidate(
  recommendation_id uuid,
  requester_email text,
  breakout_agent_name text,
  breakout_model_name text,
  epic_domain text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare rec public.epic_recommendations; session_id uuid;
begin
  select * into rec from public.epic_recommendations
  where id = recommendation_id and user_id = auth.uid() and status = 'pending' for update;
  if rec.id is null then raise exception 'Pending Epic recommendation not found'; end if;

  update public.tickets set item_type = 'Epic', updated_at = now()
  where id = rec.ticket_id and user_id = auth.uid();

  insert into public.epic_breakout_sessions (epic_id, requester_email, agent_name, model_name, domain)
  values (rec.ticket_id, requester_email, breakout_agent_name, breakout_model_name, epic_domain)
  returning id into session_id;

  update public.epic_recommendations set status = 'confirmed' where id = rec.id;
  return jsonb_build_object('epic_id', rec.ticket_id, 'session_id', session_id);
end;
$$;
