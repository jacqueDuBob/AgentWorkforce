-- Repair databases where 014 was applied before 013, then restore the final
-- worker-managed Git prompt state expected after 016 and 017.

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

insert into public.column_agents (column_name, name, model_name, instructions, start_mode, enabled)
values (
  'In Deployment',
  'Deployment Agent',
  'gpt-5.6-luna',
  'Execute deployment only after a successful git push. Keep the deployment interface target-agnostic. Do not perform testing, review, implementation, or other workflow tasks.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}',
  'automatic',
  true
)
on conflict (column_name) do nothing;

update public.column_agents
set instructions = 'Implement the approved change in the configured repository. The worker has already prepared a non-base ticket branch. If the work item contains review findings, address every finding on the existing ticket branch. Run relevant checks. Leave the completed changes uncommitted for the Review Agent. Do not create or switch branches, commit, or push.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}\n\nWorkflow contract: if you encounter material uncertainty, ask concise questions instead of guessing. Return JSON with summary, questions (an array of strings), and proposals (an array of objects with title, description, and changes). Keep questions and proposals empty when none are needed. Proposed changes are advisory and require participant approval.'
where column_name = 'In Work';

update public.column_agents
set instructions = 'Review the uncommitted implementation against the work item, acceptance criteria, repository instructions, and existing architecture. Run appropriate verification. Do not create or switch branches, commit, or push; the worker handles Git metadata after a clean review. Return every actionable finding, or an empty findings array when the review is clean. Return JSON matching the provided schema.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}'
where column_name = 'In Review';
