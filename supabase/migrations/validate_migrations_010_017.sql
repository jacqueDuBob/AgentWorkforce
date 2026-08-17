-- Validate the final database state expected after migrations 010 through 017.
--
-- This script is read-only. Run it in the Supabase SQL editor after applying
-- 010_database_prompt_templates.sql through
-- 017_ticket_conversations_notifications.sql. It raises a single exception
-- containing every missing object or state; otherwise it prints a success notice.

do $validation$
declare
  failures text[] := array[]::text[];
  constraint_definition text;
begin
  -- 010: database prompt templates and rendered prompt snapshots.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'column_agents'
      and column_name = 'refinement_questions_prompt'
  ) then failures := array_append(failures, '010: column_agents.refinement_questions_prompt is missing'); end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'column_agents'
      and column_name = 'refinement_rewrite_prompt'
  ) then failures := array_append(failures, '010: column_agents.refinement_rewrite_prompt is missing'); end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'column_agents'
      and column_name = 'epic_breakout_prompt'
  ) then failures := array_append(failures, '010: column_agents.epic_breakout_prompt is missing'); end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_runs'
      and column_name = 'rendered_prompt'
  ) then failures := array_append(failures, '010: agent_runs.rendered_prompt is missing'); end if;

  -- 011-012: repository-aware refinement/epic runs and priority claiming.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_runs' and column_name = 'run_kind'
  ) then failures := array_append(failures, '011: agent_runs.run_kind is missing'); end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_runs' and column_name = 'queue_class'
  ) then failures := array_append(failures, '011: agent_runs.queue_class is missing'); end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_runs' and column_name = 'run_input'
  ) then failures := array_append(failures, '011: agent_runs.run_input is missing'); end if;

  select pg_get_constraintdef(oid) into constraint_definition
  from pg_constraint
  where conrelid = 'public.agent_runs'::regclass and conname = 'agent_runs_run_kind_check';
  if constraint_definition is null or constraint_definition not like '%epic_breakout%' then
    failures := array_append(failures, '012: agent_runs_run_kind_check does not allow epic_breakout');
  end if;

  if to_regclass('public.agent_runs_claim_priority_idx') is null then
    failures := array_append(failures, '011: agent_runs_claim_priority_idx is missing');
  end if;

  if to_regprocedure('public.claim_next_agent_run_for_worker(uuid)') is null then
    failures := array_append(failures, '011: claim_next_agent_run_for_worker(uuid) is missing');
  end if;

  -- 013: deployment workflow stages and canonical deployment agent.
  select pg_get_constraintdef(oid) into constraint_definition
  from pg_constraint
  where conrelid = 'public.tickets'::regclass and conname = 'tickets_status_check';
  if constraint_definition is null
     or constraint_definition not like '%In Deployment%'
     or constraint_definition not like '%Deployed%' then
    failures := array_append(failures, '013: tickets_status_check lacks deployment stages');
  end if;

  if not exists (select 1 from public.column_agents where column_name = 'In Deployment') then
    failures := array_append(failures, '013: the In Deployment column agent is missing');
  end if;

  -- 014: workspace roles and globally canonical column agents.
  if to_regclass('public.user_roles') is null then
    failures := array_append(failures, '014: public.user_roles is missing');
  else
    if not (select relrowsecurity from pg_class where oid = 'public.user_roles'::regclass) then
      failures := array_append(failures, '014: RLS is not enabled on public.user_roles');
    end if;
  end if;

  if to_regprocedure('public.is_admin(uuid)') is null then
    failures := array_append(failures, '014: is_admin(uuid) is missing');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'column_agents' and column_name = 'user_id'
  ) then failures := array_append(failures, '014: column_agents.user_id still exists'); end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.column_agents'::regclass
      and conname = 'column_agents_column_name_key' and contype = 'u'
  ) then failures := array_append(failures, '014: canonical column_agents unique constraint is missing'); end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'column_agents'
      and policyname = 'Authenticated users read column agents'
  ) then failures := array_append(failures, '014: column agent read policy is missing'); end if;

  -- 015-016: persisted review findings and worker-managed Git instructions.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tickets' and column_name = 'findings'
  ) then failures := array_append(failures, '015: tickets.findings is missing'); end if;

  if not exists (
    select 1 from public.column_agents
    where column_name = 'In Review'
      and instructions like '%worker handles Git metadata after a clean review%'
  ) then failures := array_append(failures, '016: In Review does not have worker-managed Git instructions'); end if;

  -- 017: conversations, questions, proposals, and notifications.
  if to_regclass('public.ticket_comments') is null then
    failures := array_append(failures, '017: public.ticket_comments is missing');
  elsif not (select relrowsecurity from pg_class where oid = 'public.ticket_comments'::regclass) then
    failures := array_append(failures, '017: RLS is not enabled on public.ticket_comments');
  end if;

  if to_regclass('public.agent_questions') is null then
    failures := array_append(failures, '017: public.agent_questions is missing');
  elsif not (select relrowsecurity from pg_class where oid = 'public.agent_questions'::regclass) then
    failures := array_append(failures, '017: RLS is not enabled on public.agent_questions');
  end if;

  if to_regclass('public.ticket_proposals') is null then
    failures := array_append(failures, '017: public.ticket_proposals is missing');
  elsif not (select relrowsecurity from pg_class where oid = 'public.ticket_proposals'::regclass) then
    failures := array_append(failures, '017: RLS is not enabled on public.ticket_proposals');
  end if;

  if to_regclass('public.notifications') is null then
    failures := array_append(failures, '017: public.notifications is missing');
  elsif not (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass) then
    failures := array_append(failures, '017: RLS is not enabled on public.notifications');
  end if;

  if to_regprocedure('public.can_access_ticket(uuid)') is null then
    failures := array_append(failures, '017: can_access_ticket(uuid) is missing');
  end if;
  if to_regprocedure('public.notify_ticket_participants(uuid,text,text,text)') is null then
    failures := array_append(failures, '017: notify_ticket_participants(uuid,text,text,text) is missing');
  end if;
  if to_regprocedure('public.resolve_agent_question(uuid,text)') is null then
    failures := array_append(failures, '017: resolve_agent_question(uuid,text) is missing');
  end if;
  if to_regprocedure('public.approve_ticket_proposal(uuid,text)') is null then
    failures := array_append(failures, '017: approve_ticket_proposal(uuid,text) is missing');
  end if;

  select pg_get_constraintdef(oid) into constraint_definition
  from pg_constraint
  where conrelid = 'public.agent_runs'::regclass and conname = 'agent_runs_status_check';
  if constraint_definition is null or constraint_definition not like '%waiting_for_answer%' then
    failures := array_append(failures, '017: agent_runs_status_check does not allow waiting_for_answer');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ticket_comments'
      and policyname = 'Participants post ticket comments'
  ) then failures := array_append(failures, '017: ticket comment insert policy is missing'); end if;

  if to_regclass('public.notifications_user_created_idx') is null then
    failures := array_append(failures, '017: notifications_user_created_idx is missing');
  end if;

  if cardinality(failures) > 0 then
    raise exception E'Migrations 010-017 validation failed:\n- %', array_to_string(failures, E'\n- ');
  end if;

  raise notice 'Validation passed: the final database state for migrations 010-017 is present.';
end
$validation$;
