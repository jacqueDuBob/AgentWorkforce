-- Harden the ticket collaboration workflow and carry resolved answers into a resumed run.
alter table public.agent_runs
  add column if not exists resume_context jsonb not null default '[]'::jsonb;

create or replace function public.resolve_agent_question(question_id uuid, response text)
returns public.agent_questions
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved public.agent_questions;
begin
  if char_length(trim(response)) = 0 then
    raise exception 'An answer is required';
  end if;

  update public.agent_questions q
  set answer = trim(response), status = 'resolved', resolved_at = now()
  where q.id = question_id
    and q.status = 'open'
    and public.can_access_ticket(q.ticket_id)
  returning q into resolved;

  if resolved.id is null then
    return null;
  end if;

  update public.agent_runs
  set resume_context = coalesce(resume_context, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('question', resolved.question, 'answer', trim(response))
      ),
      status = case when not exists (
        select 1 from public.agent_questions q where q.run_id = resolved.run_id and q.status = 'open'
      ) then 'queued' else status end,
      worker_id = case when not exists (
        select 1 from public.agent_questions q where q.run_id = resolved.run_id and q.status = 'open'
      ) then null else worker_id end,
      started_at = case when not exists (
        select 1 from public.agent_questions q where q.run_id = resolved.run_id and q.status = 'open'
      ) then null else started_at end,
      finished_at = null,
      updated_at = now()
  where id = resolved.run_id and status = 'waiting_for_answer';

  return resolved;
end;
$$;

revoke all on function public.resolve_agent_question(uuid, text) from public, anon;
grant execute on function public.resolve_agent_question(uuid, text) to authenticated;

create or replace function public.approve_ticket_proposal(proposal_id uuid, decision text)
returns public.ticket_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.ticket_proposals;
  changes jsonb;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Invalid proposal decision';
  end if;

  select p.* into proposal
  from public.ticket_proposals p
  where p.id = proposal_id
    and p.status = 'pending'
    and public.can_access_ticket(p.ticket_id)
  for update;
  if proposal.id is null then
    return null;
  end if;

  changes := proposal.changes;
  if decision = 'approved' then
    update public.tickets set
      title = case when changes ? 'title' and jsonb_typeof(changes->'title') = 'string'
        then left(trim(changes->>'title'), 120) else title end,
      description = case when changes ? 'description' and jsonb_typeof(changes->'description') = 'string'
        then changes->>'description' else description end,
      priority = case when changes->>'priority' in ('Low','Medium','High','Urgent')
        then changes->>'priority' else priority end,
      tags = case when jsonb_typeof(changes->'tags') = 'array'
        then array(select value from jsonb_array_elements_text(changes->'tags') with ordinality as item(value, position)
          where char_length(trim(value)) > 0 order by position limit 3)
        else tags end,
      assignee = case when changes ? 'assignee' and jsonb_typeof(changes->'assignee') = 'string'
        then trim(changes->>'assignee') else assignee end,
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

create or replace function public.notify_comment_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_ticket_participants(
    new.ticket_id, 'comment', 'New ticket comment', left(new.body, 240)
  );
  return new;
end;
$$;

revoke all on function public.notify_comment_participants() from public, anon, authenticated;
grant execute on function public.notify_comment_participants() to service_role;

drop trigger if exists ticket_comments_notify_participants on public.ticket_comments;
create trigger ticket_comments_notify_participants
after insert on public.ticket_comments
for each row execute function public.notify_comment_participants();
