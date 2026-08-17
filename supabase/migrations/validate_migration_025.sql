do $$
declare failures text[] := '{}';
declare constraint_definition text;
begin
  select pg_get_constraintdef(oid) into constraint_definition
  from pg_constraint where conrelid = 'public.tickets'::regclass and conname = 'tickets_status_check';
  if constraint_definition is null or constraint_definition like '%In Work%' or constraint_definition not like '%Ready to Deploy%' then
    failures := array_append(failures, '025: tickets_status_check does not reflect the eight-column board');
  end if;

  select pg_get_constraintdef(oid) into constraint_definition
  from pg_constraint where conrelid = 'public.column_agents'::regclass and conname = 'column_agents_column_name_check';
  if constraint_definition is null or constraint_definition like '%In Review%' or constraint_definition not like '%Ready to Deploy%' then
    failures := array_append(failures, '025: column_agents_column_name_check does not reflect the eight-column board');
  end if;

  if exists (select 1 from public.tickets where status not in ('Inbox','Refinement','Ready','In Progress','Review','Validation','Ready to Deploy','Live')) then
    failures := array_append(failures, '025: a ticket has a status outside the eight canonical columns');
  end if;

  if exists (select 1 from public.column_agents where column_name not in ('Inbox','Refinement','Ready','In Progress','Review','Validation','Ready to Deploy','Live')) then
    failures := array_append(failures, '025: a column agent has a column_name outside the eight canonical columns');
  end if;

  if (select count(distinct column_name) from public.column_agents) <> (select count(*) from public.column_agents) then
    failures := array_append(failures, '025: column_agents has more than one row for a single column');
  end if;

  if to_regclass('public.column_agent_archive') is null then
    failures := array_append(failures, '025: column_agent_archive is missing');
  end if;

  if not exists (
    select 1 from pg_constraint where conrelid = 'public.agent_run_outbox'::regclass and conname = 'agent_run_outbox_event_type_check'
      and pg_get_constraintdef(oid) like '%queue_development%'
  ) then
    failures := array_append(failures, '025: agent_run_outbox does not accept queue_development events');
  end if;

  if to_regprocedure('public.__migrate_column_agent_group(text,text[])') is not null then
    failures := array_append(failures, '025: the one-time migration helper function was not dropped');
  end if;

  if array_length(failures, 1) > 0 then
    raise exception '%', array_to_string(failures, E'\n');
  end if;
end $$;

-- Manual, environment-specific checks to run against a copy of production data
-- before and after applying this migration (not asserted above):
--   1. For a handful of tickets in each of the 13 legacy statuses, confirm the
--      post-migration status matches the documented mapping and that relative
--      ordering within any merged column follows old-column-rank then position.
--   2. Confirm no row in agent_runs, agent_run_attempts, or agent_run_outbox
--      was created by this migration (row counts identical before/after).
--   3. Confirm every customized column agent (non-default name/instructions)
--      that existed before migration is either present under its new column
--      name or findable in column_agent_archive.
