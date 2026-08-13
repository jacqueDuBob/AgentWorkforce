-- Add deployment stages after completed testing and seed the deployment agent.
alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets add constraint tickets_status_check check (status in (
  'New','In Refinement','Ready','In Work','Work Completed','In Review',
  'Review Completed','In Testing','Testing Completed','In Deployment','Deployed',
  'Ready for Live','Live'
));

alter table public.column_agents drop constraint if exists column_agents_column_name_check;
alter table public.column_agents add constraint column_agents_column_name_check check (column_name in (
  'New','In Refinement','Ready','In Work','Work Completed','In Review',
  'Review Completed','In Testing','Testing Completed','In Deployment','Deployed',
  'Ready for Live','Live'
));

alter table public.column_agents add column if not exists model_name text not null default 'gpt-5.6-luna';
alter table public.column_agents add column if not exists repository_access text not null default 'all';

insert into public.column_agents (user_id, column_name, name, model_name, instructions, start_mode, enabled)
select users.id, 'In Deployment', 'Deployment Agent', 'gpt-5.6-luna',
  'Execute deployment only after a successful git push. Keep the deployment interface target-agnostic. Do not perform testing, review, implementation, or other workflow tasks.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}',
  'automatic', true
from auth.users as users
on conflict (user_id, column_name) do nothing;

update public.column_agents
set instructions = instructions || E'\n\nIf and only if a git push command succeeds, include the exact line GIT_PUSH_SUCCEEDED: true in your final response.'
where column_name = 'In Work'
  and instructions not like '%GIT_PUSH_SUCCEEDED: true%';

create or replace function public.create_default_deployment_agent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.column_agents (user_id, column_name, name, model_name, instructions, start_mode, enabled)
  values (new.id, 'In Deployment', 'Deployment Agent', 'gpt-5.6-luna',
    'Execute deployment only after a successful git push. Keep the deployment interface target-agnostic. Do not perform testing, review, implementation, or other workflow tasks.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}', 'automatic', true)
  on conflict (user_id, column_name) do nothing;
  return new;
end;
$$;

drop trigger if exists create_default_deployment_agent_after_signup on auth.users;
create trigger create_default_deployment_agent_after_signup
  after insert on auth.users
  for each row execute function public.create_default_deployment_agent();
