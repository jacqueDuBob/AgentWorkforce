alter table public.agent_runs
  drop constraint if exists agent_runs_status_check;

update public.agent_runs
set status = case
  when status = 'queued' then 'queued'
  when status in ('running', 'awaiting_approval', 'in_progress') then 'in_progress'
  else 'finished'
end;

alter table public.agent_runs
  alter column status set default 'queued',
  add constraint agent_runs_status_check
    check (status in ('queued', 'in_progress', 'finished'));

-- Workers call this function to atomically reserve the oldest queued run.
-- FOR UPDATE SKIP LOCKED prevents concurrent workers from receiving the same run.
create or replace function public.claim_next_agent_run()
returns public.agent_runs
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed public.agent_runs;
begin
  select * into claimed
  from public.agent_runs
  where user_id = auth.uid() and status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update public.agent_runs
  set status = 'in_progress', updated_at = now(), error = null
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

create or replace function public.finish_agent_run(
  run_id uuid,
  run_output jsonb default null,
  run_error text default null
)
returns public.agent_runs
language plpgsql
security invoker
set search_path = public
as $$
declare
  finished public.agent_runs;
begin
  update public.agent_runs
  set status = 'finished',
      output = coalesce(run_output, output),
      error = nullif(run_error, ''),
      updated_at = now()
  where id = run_id
    and user_id = auth.uid()
    and status = 'in_progress'
  returning * into finished;

  return finished;
end;
$$;
