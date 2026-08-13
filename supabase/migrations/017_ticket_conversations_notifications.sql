-- Ticket conversations, blocked agent questions, approval-gated proposals, and in-app notifications.
create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.agent_questions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 2000),
  answer text,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.ticket_proposals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  proposed_by uuid references auth.users(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '',
  changes jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete cascade,
  kind text not null check (kind in ('comment','question','proposal','execution')),
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.agent_runs drop constraint if exists agent_runs_status_check;
alter table public.agent_runs add constraint agent_runs_status_check
  check (status in ('queued','in_progress','waiting_for_answer','finished'));

update public.column_agents
set instructions = instructions || E'\n\nWorkflow contract: if you encounter material uncertainty, ask concise questions instead of guessing. Return JSON with summary, questions (an array of strings), and proposals (an array of objects with title, description, and changes). Keep questions and proposals empty when none are needed. Proposed changes are advisory and require participant approval.'
where column_name = 'In Work';

create or replace function public.can_access_ticket(candidate_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tickets t where t.id = candidate_ticket_id
    and (t.user_id = auth.uid() or lower(coalesce(t.assignee, '')) = lower(coalesce(auth.email(), ''))));
$$;
revoke all on function public.can_access_ticket(uuid) from public, anon;
grant execute on function public.can_access_ticket(uuid) to authenticated;

alter table public.ticket_comments enable row level security;
alter table public.agent_questions enable row level security;
alter table public.ticket_proposals enable row level security;
alter table public.notifications enable row level security;

create policy "Participants read ticket comments" on public.ticket_comments for select to authenticated using (public.can_access_ticket(ticket_id));
create policy "Participants post ticket comments" on public.ticket_comments for insert to authenticated with check (author_id = auth.uid() and public.can_access_ticket(ticket_id));
create policy "Participants read agent questions" on public.agent_questions for select to authenticated using (public.can_access_ticket(ticket_id));
create policy "Participants resolve agent questions" on public.agent_questions for update to authenticated using (public.can_access_ticket(ticket_id)) with check (public.can_access_ticket(ticket_id));
create policy "Participants read ticket proposals" on public.ticket_proposals for select to authenticated using (public.can_access_ticket(ticket_id));
create policy "Participants create ticket proposals" on public.ticket_proposals for insert to authenticated with check (proposed_by = auth.uid() and public.can_access_ticket(ticket_id));
create policy "Participants review ticket proposals" on public.ticket_proposals for update to authenticated using (public.can_access_ticket(ticket_id)) with check (public.can_access_ticket(ticket_id));
create policy "Users read their notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "Users update their notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index ticket_comments_ticket_created_idx on public.ticket_comments(ticket_id, created_at);
create index agent_questions_ticket_status_idx on public.agent_questions(ticket_id, status, created_at);
create index ticket_proposals_ticket_status_idx on public.ticket_proposals(ticket_id, status, created_at);
create index notifications_user_created_idx on public.notifications(user_id, created_at desc);

create or replace function public.notify_ticket_participants(candidate_ticket_id uuid, notification_kind text, notification_title text, notification_body text)
returns void language plpgsql security definer set search_path = public as $$
declare ticket_owner uuid;
declare ticket_assignee uuid;
begin
  select t.user_id, u.id into ticket_owner, ticket_assignee from public.tickets t
    left join auth.users u on lower(u.email) = lower(nullif(t.assignee, '')) where t.id = candidate_ticket_id;
  if ticket_owner is not null then
    insert into public.notifications(user_id, ticket_id, kind, title, body)
    values (ticket_owner, candidate_ticket_id, notification_kind, notification_title, notification_body);
  end if;
  if ticket_assignee is not null and ticket_assignee <> ticket_owner then
    insert into public.notifications(user_id, ticket_id, kind, title, body)
    values (ticket_assignee, candidate_ticket_id, notification_kind, notification_title, notification_body);
  end if;
end;
$$;
revoke all on function public.notify_ticket_participants(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_ticket_participants(uuid, text, text, text) to service_role;

-- Worker-only writes use the service role; this function makes an answered question re-queue its run atomically.
create or replace function public.resolve_agent_question(question_id uuid, response text)
returns public.agent_questions language plpgsql security invoker set search_path = public as $$
declare resolved public.agent_questions;
begin
  if char_length(trim(response)) = 0 then raise exception 'An answer is required'; end if;
  update public.agent_questions q set answer = trim(response), status = 'resolved', resolved_at = now()
    where q.id = question_id and q.status = 'open' and public.can_access_ticket(q.ticket_id)
    returning q into resolved;
  if resolved.id is null then return null; end if;
  if not exists (select 1 from public.agent_questions q where q.run_id = resolved.run_id and q.status = 'open') then
    update public.agent_runs set status = 'queued', worker_id = null, started_at = null, updated_at = now()
      where id = resolved.run_id and status = 'waiting_for_answer';
  end if;
  return resolved;
end;
$$;
revoke all on function public.resolve_agent_question(uuid, text) from public, anon;
grant execute on function public.resolve_agent_question(uuid, text) to authenticated;

create or replace function public.approve_ticket_proposal(proposal_id uuid, decision text)
returns public.ticket_proposals language plpgsql security invoker set search_path = public as $$
declare proposal public.ticket_proposals; changes jsonb;
begin
  if decision not in ('approved', 'rejected') then raise exception 'Invalid proposal decision'; end if;
  select p.* into proposal from public.ticket_proposals p where p.id = proposal_id
    and p.status = 'pending' and public.can_access_ticket(p.ticket_id) for update;
  if proposal.id is null then return null; end if;
  changes := proposal.changes;
  if decision = 'approved' then
    update public.tickets set
      title = case when changes ? 'title' then left(trim(changes->>'title'), 120) else title end,
      description = case when changes ? 'description' then changes->>'description' else description end,
      priority = case when changes->>'priority' in ('Low','Medium','High','Urgent') then changes->>'priority' else priority end,
      tags = case when jsonb_typeof(changes->'tags') = 'array' then array(select jsonb_array_elements_text(changes->'tags') limit 3) else tags end,
      assignee = case when changes ? 'assignee' then changes->>'assignee' else assignee end,
      updated_at = now()
    where id = proposal.ticket_id;
  end if;
  update public.ticket_proposals set status = decision, reviewed_by = auth.uid(), reviewed_at = now()
    where id = proposal_id returning * into proposal;
  return proposal;
end;
$$;
revoke all on function public.approve_ticket_proposal(uuid, text) from public, anon;
grant execute on function public.approve_ticket_proposal(uuid, text) to authenticated;
