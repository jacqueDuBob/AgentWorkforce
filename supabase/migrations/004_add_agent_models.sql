alter table public.column_agents
  add column model_name text not null default 'gpt-5.6-luna'
  check (char_length(model_name) between 1 and 100);

alter table public.agent_runs
  add column model_name text not null default 'gpt-5.6-luna'
  check (char_length(model_name) between 1 and 100);
