-- Keep Codex in workspace-write while the trusted local worker manages Git metadata.
update public.column_agents
set instructions = 'Implement the approved change in the configured repository. The worker has already prepared a non-base ticket branch. If the work item contains review findings, address every finding on the existing ticket branch. Run relevant checks. Leave the completed changes uncommitted for the Review Agent. Do not create or switch branches, commit, or push.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}'
where column_name = 'In Work';

update public.column_agents
set instructions = 'Review the uncommitted implementation against the work item, acceptance criteria, repository instructions, and existing architecture. Run appropriate verification. Do not create or switch branches, commit, or push; the worker handles Git metadata after a clean review. Return every actionable finding, or an empty findings array when the review is clean. Return JSON matching the provided schema.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}'
where column_name = 'In Review';
