alter table public.column_agents
  add column if not exists refinement_questions_prompt text not null default '',
  add column if not exists refinement_rewrite_prompt text not null default '',
  add column if not exists epic_breakout_prompt text not null default '';

alter table public.agent_runs
  add column if not exists rendered_prompt text not null default '';

-- Existing execution prompts become templates enriched with the runtime context.
update public.column_agents
set instructions = instructions || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}'
where instructions not like '%{{ticket}}%';

update public.column_agents
set refinement_questions_prompt = E'You are a product refinement agent. Classify which connected repository best fits the ticket, using only an exact repository id from the list. If none fit or none exist, return an empty repositoryId. Treat the selected repository metadata as context. Then ask 2-5 concise questions that resolve the most important ambiguities. Each question must have exactly three short, realistic, mutually exclusive suggested answers. Do not include an "Other" suggestion because the UI supplies a free-text answer.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nAgent name:\n{{agentName}}\n\nRepositories:\n{{repository}}\n\nTicket:\n{{ticket}}',
    refinement_rewrite_prompt = E'You are a product refinement agent. Rewrite the ticket using the user answers. Preserve valid existing detail, remove ambiguity resolved by the answers, and make the description and acceptance criteria implementation-ready. Acceptance criteria should be concise, testable lines. Do not invent requirements. Return no more than three short tags. Recommend an Epic only when the outcome requires multiple independently deliverable child tickets, crosses a repository or application-domain boundary, or cannot safely be delivered in one implementation and review cycle. Do not recommend an Epic merely because the work is difficult, uncertain, or has several implementation steps. Give a concise evidence-based reason.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nAgent name:\n{{agentName}}\n\nRepositories:\n{{repository}}\n\nAnswers:\n{{refinementAnswers}}\n\nTicket:\n{{ticket}}',
    epic_breakout_prompt = E'You are {{agentName}}, a specialized Epic breakout agent for {{domain}}. Decompose the Epic into independently actionable child tickets. Do not repeat the Epic itself or invent unrelated scope. Each child needs testable acceptance criteria. The requesting participant is {{requesterEmail}}.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nEpic:\n{{ticket}}'
where column_name = 'In Refinement';

create or replace function public.create_default_column_agents(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  context_suffix text := E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}';
begin
  insert into public.column_agents (user_id, column_name, name, model_name, instructions, refinement_questions_prompt, refinement_rewrite_prompt, epic_breakout_prompt)
  values
    (target_user_id, 'New', 'New Agent', 'gpt-5.6-luna', 'Review the request, identify its intent, and flag missing information.' || context_suffix, '', '', ''),
    (target_user_id, 'In Refinement', 'In Refinement Agent', 'gpt-5.6-luna', 'Classify the best repository, ask focused questions, and decide whether the refined work should become an Epic.' || context_suffix,
      E'You are a product refinement agent. Classify which connected repository best fits the ticket, using only an exact repository id from the list. If none fit or none exist, return an empty repositoryId. Then ask 2-5 concise questions that resolve the most important ambiguities. Each question must have exactly three short, realistic, mutually exclusive suggested answers. Do not include an "Other" suggestion.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nRepositories:\n{{repository}}\n\nTicket:\n{{ticket}}',
      E'Rewrite the ticket using the user answers. Preserve valid existing detail, remove resolved ambiguity, and make the description and acceptance criteria implementation-ready. Do not invent requirements. Return no more than three short tags. Recommend an Epic only for multiple independently deliverable child tickets, a repository or application-domain boundary, or work that cannot safely be delivered in one implementation and review cycle.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nRepositories:\n{{repository}}\n\nAnswers:\n{{refinementAnswers}}\n\nTicket:\n{{ticket}}',
      E'You are {{agentName}}, a specialized Epic breakout agent for {{domain}}. Decompose the Epic into independently actionable child tickets. Do not repeat the Epic or invent unrelated scope. Each child needs testable acceptance criteria. The requesting participant is {{requesterEmail}}.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nEpic:\n{{ticket}}'),
    (target_user_id, 'Ready', 'Ready Agent', 'gpt-5.6-luna', 'Confirm the work is actionable and produce a concise implementation plan.' || context_suffix, '', '', ''),
    (target_user_id, 'In Work', 'In Work Agent', 'gpt-5.6-luna', 'Implement the approved change in the configured repository on a new branch. Run relevant checks and summarize changes and risks. If and only if a git push command succeeds, include the exact line GIT_PUSH_SUCCEEDED: true in your final response.' || context_suffix, '', '', ''),
    (target_user_id, 'Work Completed', 'Work Completed Agent', 'gpt-5.6-luna', 'Review the implementation for completeness and prepare a pull request summary.' || context_suffix, '', '', ''),
    (target_user_id, 'In Review', 'In Review Agent', 'gpt-5.6-luna', 'Review the proposed code changes and report concrete findings.' || context_suffix, '', '', ''),
    (target_user_id, 'Review Completed', 'Review Completed Agent', 'gpt-5.6-luna', 'Apply or verify approved review changes and summarize the result.' || context_suffix, '', '', ''),
    (target_user_id, 'In Testing', 'In Testing Agent', 'gpt-5.6-luna', 'Design and run appropriate tests for the change.' || context_suffix, '', '', ''),
    (target_user_id, 'Testing Completed', 'Testing Completed Agent', 'gpt-5.6-luna', 'Summarize test evidence and identify remaining release risks.' || context_suffix, '', '', ''),
    (target_user_id, 'Ready for Live', 'Ready for Live Agent', 'gpt-5.6-luna', 'Prepare release notes and verify the change is ready to merge or deploy.' || context_suffix, '', '', ''),
    (target_user_id, 'Live', 'Live Agent', 'gpt-5.6-luna', 'Confirm the release outcome and create a concise completion summary.' || context_suffix, '', '', '')
  on conflict (user_id, column_name) do nothing;
end;
$$;

do $$
declare existing_user record;
begin
  for existing_user in select id from auth.users loop
    perform public.create_default_column_agents(existing_user.id);
  end loop;
end;
$$;

create or replace function public.create_default_column_agents_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_default_column_agents(new.id);
  return new;
end;
$$;

drop trigger if exists create_default_column_agents_after_signup on auth.users;
create trigger create_default_column_agents_after_signup
  after insert on auth.users
  for each row execute function public.create_default_column_agents_for_new_user();

revoke all on function public.create_default_column_agents(uuid) from public, anon, authenticated;
