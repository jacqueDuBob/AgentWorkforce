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
