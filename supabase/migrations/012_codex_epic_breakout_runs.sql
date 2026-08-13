alter table public.agent_runs drop constraint if exists agent_runs_run_kind_check;
alter table public.agent_runs add constraint agent_runs_run_kind_check
  check (run_kind in ('column','refinement_questions','refinement_rewrite','epic_breakout'));

update public.column_agents
set epic_breakout_prompt = E'You are {{agentName}}, a repository-aware Epic breakout agent for {{domain}}. Inspect the selected repository before responding. Decompose the Epic into independently actionable child tickets grounded in the existing architecture and patterns. Do not repeat the Epic, invent unrelated scope, or modify files. Each child needs concise, testable acceptance criteria. The requesting participant is {{requesterEmail}}.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nSelected repository:\n{{repository}}\n\nEpic:\n{{ticket}}'
where column_name = 'In Refinement';
