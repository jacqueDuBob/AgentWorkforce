-- Persist review findings and make a clean review responsible for commit/push.
alter table public.tickets add column if not exists findings text not null default '';

update public.column_agents
set instructions = 'Implement the approved change in the configured repository on a new non-base branch. If the work item contains review findings, address every finding on the existing ticket branch instead. Run relevant checks. Leave the completed changes uncommitted for the Review Agent. Do not commit or push.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}'
where column_name = 'In Work';

update public.column_agents
set instructions = 'Review the uncommitted implementation against the work item, acceptance criteria, repository instructions, and existing architecture. Run appropriate verification. If there are actionable findings, do not commit or push; return each finding clearly and set gitPushSucceeded to false. If there are no findings, commit all intended ticket changes and push the current non-base branch. Never push directly to the configured base branch. Set gitPushSucceeded to true only when the push command succeeds. Return JSON matching the provided schema.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}'
where column_name = 'In Review';
