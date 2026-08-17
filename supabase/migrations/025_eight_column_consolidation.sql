-- Consolidate the 13-column workflow into the canonical eight-column board:
-- Inbox, Refinement, Ready, In Progress, Review, Validation, Ready to Deploy, Live.
-- This migration only relabels/merges workflow columns and their agent
-- configuration; it never queues agents, creates attempts, or mutates any
-- historical agent_runs.job_spec/canonical_result evidence.

-- 1. Drop the legacy status/column-name constraints so data can be migrated.
alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.column_agents drop constraint if exists column_agents_column_name_check;

-- 2. Preserve superseded column-agent configurations without building a full
-- configuration-versioning system.
create table public.column_agent_archive (
  id uuid primary key default gen_random_uuid(),
  original_agent_id uuid not null,
  column_name text not null,
  name text not null,
  model_name text not null,
  instructions text not null,
  refinement_questions_prompt text not null default '',
  refinement_rewrite_prompt text not null default '',
  epic_breakout_prompt text not null default '',
  start_mode text not null,
  enabled boolean not null,
  repository_access text not null,
  allowed_repository_ids jsonb not null default '[]'::jsonb,
  superseded_by_column text not null,
  archived_at timestamptz not null default now()
);
alter table public.column_agent_archive enable row level security;
create policy "Admins read archived column agents" on public.column_agent_archive
  for select to authenticated using (public.is_admin());

-- 3. Migrate ticket status. Preserve ticket IDs and deterministic ordering:
-- within a merged target column, order by the old column's rank followed by
-- the ticket's existing position. This is a plain UPDATE with no triggers
-- that queue work, so no agent execution or side effects occur.
with status_map(old_status, new_status, old_rank) as (
  values
    ('New', 'Inbox', 0),
    ('In Refinement', 'Refinement', 1),
    ('Ready', 'Ready', 2),
    ('In Work', 'In Progress', 3),
    ('Work Completed', 'Review', 4),
    ('In Review', 'Review', 5),
    ('Review Completed', 'Validation', 6),
    ('In Testing', 'Validation', 7),
    ('Testing Completed', 'Ready to Deploy', 8),
    ('In Deployment', 'Ready to Deploy', 9),
    ('Deployed', 'Live', 10),
    ('Ready for Live', 'Live', 11),
    ('Live', 'Live', 12)
),
ranked as (
  select t.id, m.new_status,
    row_number() over (partition by t.user_id, m.new_status order by m.old_rank, t.position, t.id) - 1 as new_position
  from public.tickets t
  join status_map m on m.old_status = t.status
)
update public.tickets t set status = ranked.new_status, position = ranked.new_position
from ranked where ranked.id = t.id;

-- 4. Migrate column-agent configuration. Direct 1:1 renames keep the same row
-- (preserving id, model, prompts, enabled state, start mode, and repository
-- permissions, which are keyed off the row's id).
update public.column_agents set column_name = 'Inbox', updated_at = now() where column_name = 'New';
update public.column_agents set column_name = 'Refinement', updated_at = now() where column_name = 'In Refinement';
update public.column_agents set column_name = 'In Progress', updated_at = now() where column_name = 'In Work';
-- Ready and Live keep their existing column_name.

-- Merged targets: pick a winner by preference, archive the rest, then rename
-- the winner. column_agent_repositories rows follow the surviving agent id
-- unchanged; archived rows are cascaded away with their agent row.
create function public.__migrate_column_agent_group(target_column text, priority_columns text[])
returns void language plpgsql set search_path = public, pg_temp as $$
declare winner_id uuid; candidate text; loser record;
begin
  foreach candidate in array priority_columns loop
    select id into winner_id from public.column_agents where column_name = candidate;
    exit when winner_id is not null;
  end loop;
  if winner_id is null then return; end if;
  for loser in
    select ca.*, coalesce((select jsonb_agg(repository_id) from public.column_agent_repositories where column_agent_id = ca.id), '[]'::jsonb) as repo_ids
    from public.column_agents ca where ca.column_name = any(priority_columns) and ca.id <> winner_id
  loop
    insert into public.column_agent_archive(
      original_agent_id, column_name, name, model_name, instructions, refinement_questions_prompt,
      refinement_rewrite_prompt, epic_breakout_prompt, start_mode, enabled, repository_access,
      allowed_repository_ids, superseded_by_column
    ) values (
      loser.id, loser.column_name, loser.name, loser.model_name, loser.instructions, loser.refinement_questions_prompt,
      loser.refinement_rewrite_prompt, loser.epic_breakout_prompt, loser.start_mode, loser.enabled, loser.repository_access,
      loser.repo_ids, target_column
    );
    delete from public.column_agents where id = loser.id;
  end loop;
  update public.column_agents set column_name = target_column, updated_at = now() where id = winner_id;
end;
$$;

select public.__migrate_column_agent_group('Review', array['In Review', 'Work Completed']);
select public.__migrate_column_agent_group('Validation', array['In Testing', 'Review Completed']);
select public.__migrate_column_agent_group('Ready to Deploy', array['In Deployment', 'Testing Completed', 'Deployed', 'Ready for Live']);

drop function public.__migrate_column_agent_group(text, text[]);

-- 5. Apply the new eight-value constraints now that data is migrated.
alter table public.tickets add constraint tickets_status_check check (status in (
  'Inbox', 'Refinement', 'Ready', 'In Progress', 'Review', 'Validation', 'Ready to Deploy', 'Live'
));
alter table public.column_agents add constraint column_agents_column_name_check check (column_name in (
  'Inbox', 'Refinement', 'Ready', 'In Progress', 'Review', 'Validation', 'Ready to Deploy', 'Live'
));

-- 6. Seed default configurations for every one of the eight columns. This is
-- also what populates a brand-new installation, since column_agents has been
-- a single global table (no per-user seeding trigger) since migration 014.
do $$
declare context_suffix text := E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}';
begin
  insert into public.column_agents (column_name, name, model_name, instructions, refinement_questions_prompt, refinement_rewrite_prompt, epic_breakout_prompt, start_mode, enabled)
  values
    ('Inbox', 'Inbox Agent', 'gpt-5.6-luna', 'Review the request, identify its intent, and flag missing information.' || context_suffix, '', '', '', 'manual', true),
    ('Refinement', 'Refinement Agent', 'gpt-5.6-luna', 'Classify the best repository, ask focused questions, and decide whether the refined work should become an Epic.' || context_suffix,
      E'You are a product refinement agent. Classify which connected repository best fits the ticket, using only an exact repository id from the list. If none fit or none exist, return an empty repositoryId. Then ask 2-5 concise questions that resolve the most important ambiguities. Each question must have exactly three short, realistic, mutually exclusive suggested answers. Do not include an "Other" suggestion.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nRepositories:\n{{repository}}\n\nTicket:\n{{ticket}}',
      E'Rewrite the ticket using the user answers. Preserve valid existing detail, remove resolved ambiguity, and make the description and acceptance criteria implementation-ready. Do not invent requirements. Return no more than three short tags. Recommend an Epic only for multiple independently deliverable child tickets, a repository or application-domain boundary, or work that cannot safely be delivered in one implementation and review cycle.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nRepositories:\n{{repository}}\n\nAnswers:\n{{refinementAnswers}}\n\nTicket:\n{{ticket}}',
      E'You are {{agentName}}, a specialized Epic breakout agent for {{domain}}. Decompose the Epic into independently actionable child tickets. Do not repeat the Epic or invent unrelated scope. Each child needs testable acceptance criteria. The requesting participant is {{requesterEmail}}.\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nEpic:\n{{ticket}}', 'manual', true),
    ('Ready', 'Ready Agent', 'gpt-5.6-luna', 'Confirm the work is actionable and produce a concise implementation plan.' || context_suffix, '', '', '', 'manual', true),
    ('In Progress', 'In Progress Agent', 'gpt-5.6-luna', 'Implement the approved change in the configured repository. The worker has already prepared a non-base ticket branch. If the work item contains review findings, address every finding on the existing ticket branch. Run relevant checks. Leave the completed changes uncommitted for the Review Agent. Do not create or switch branches, commit, or push.' || context_suffix || E'\n\nWorkflow contract: if you encounter material uncertainty, ask concise questions instead of guessing. Return JSON with summary, questions (an array of strings), and proposals (an array of objects with title, description, and changes). Keep questions and proposals empty when none are needed. Proposed changes are advisory and require participant approval.', '', '', '', 'manual', true),
    ('Review', 'Review Agent', 'gpt-5.6-luna', 'Review the implementation against the work item, acceptance criteria, repository instructions, and existing architecture. Inspect source changes and report every actionable finding, or an empty findings array when the review is clean. Do not modify files or run build, lint, type-check, or test commands. The Runner executes deterministic verification and handles Git metadata after a clean review. Return JSON matching the provided schema.' || context_suffix, '', '', '', 'manual', true),
    ('Validation', 'Validation Agent', 'gpt-5.6-luna', 'Inspect the change and identify relevant test scenarios, coverage gaps, and release risks. Do not modify files or run build, lint, type-check, or test commands. The Runner is authoritative for deterministic verification results.' || context_suffix, '', '', '', 'manual', true),
    ('Ready to Deploy', 'Deployment Agent', 'gpt-5.6-luna', 'Execute deployment only after a successful git push. Keep the deployment interface target-agnostic. Do not perform testing, review, implementation, or other workflow tasks.' || context_suffix, '', '', '', 'automatic', true),
    ('Live', 'Live Agent', 'gpt-5.6-luna', 'Confirm the release outcome and create a concise completion summary.' || context_suffix, '', '', '', 'manual', true)
  on conflict (column_name) do nothing;
end;
$$;

-- 7. Extend the deployment outbox to also carry the "return to development"
-- event produced by a review with findings.
alter table public.agent_run_outbox drop constraint if exists agent_run_outbox_event_type_check;
alter table public.agent_run_outbox add constraint agent_run_outbox_event_type_check
  check (event_type in ('queue_deployment', 'queue_development'));

-- 8. A review with findings must return the ticket to In Progress and queue a
-- new development attempt only through the same idempotent outbox pattern
-- already used for deployment; this keeps completion delivery idempotent and
-- prevents duplicate jobs on retries. Same signature as migration 023, so
-- existing grants to service_role are preserved by create or replace.
create or replace function public.finalize_agent_run_attempt(requested_worker_id uuid, requested_run_id uuid, requested_attempt_id uuid,
  requested_completion_id uuid, requested_payload_hash text, requested_output jsonb, requested_error text, requested_result_version integer,
  requested_canonical_result jsonb, requested_failure_class text, requested_retryable boolean, requested_questions jsonb,
  requested_proposals jsonb, requested_findings jsonb, requested_queue_deployment boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.agent_run_attempts; r public.agent_runs; needs_input boolean; blocked boolean; will_retry boolean; request_id uuid;
begin
  select * into a from public.agent_run_attempts where id=requested_attempt_id and run_id=requested_run_id for update;
  if a.id is null or a.worker_id<>requested_worker_id then return jsonb_build_object('state','stale'); end if;
  if a.completion_id is not null then
    if a.completion_id=requested_completion_id and a.completion_payload_hash=requested_payload_hash then return jsonb_build_object('state','duplicate','status',a.status); end if;
    return jsonb_build_object('state','conflict');
  end if;
  select * into r from public.agent_runs where id=requested_run_id and active_attempt_id=a.id for update;
  if r.id is null or a.status<>'in_progress' or a.lease_until<=now() then return jsonb_build_object('state','stale'); end if;
  needs_input := requested_error is null and requested_canonical_result->>'outcome'='needs_input';
  if needs_input and (jsonb_typeof(requested_questions) is distinct from 'object' or requested_questions->>'version' is distinct from '1'
    or requested_questions->>'jobId' is distinct from r.id::text or requested_questions->>'attemptId' is distinct from a.id::text
    or jsonb_typeof(requested_questions->'questions') is distinct from 'array' or coalesce(jsonb_array_length(requested_questions->'questions'),0)=0) then raise exception 'Invalid HumanInputRequest V1'; end if;
  blocked := needs_input and r.interaction_rounds+1 > r.max_interaction_rounds;
  will_retry := requested_error is not null and requested_retryable and r.attempt_count<r.max_attempts;
  update public.agent_run_attempts set status=case when needs_input then 'needs_input' when requested_error is null then 'succeeded' else 'failed' end,
    finished_at=now(),failure_class=requested_failure_class,retryable=requested_retryable,error=requested_error,result_version=requested_result_version,
    canonical_result=requested_canonical_result,completion_id=requested_completion_id,completion_payload_hash=requested_payload_hash where id=a.id;
  if needs_input then
    request_id := (requested_questions->>'requestId')::uuid;
    insert into public.human_input_requests(id,version,job_id,attempt_id,round_number,questions,status,created_at)
      values(request_id,1,r.id,a.id,r.interaction_rounds+1,requested_questions->'questions',case when blocked then 'blocked' else 'active' end,
        coalesce((requested_questions->>'createdAt')::timestamptz,now()));
    insert into public.agent_questions(ticket_id,run_id,question,input_request_id,stable_question_id,question_type,options)
      select r.ticket_id,r.id,q->>'prompt',request_id,q->>'id',q->>'type',coalesce(q->'options','[]'::jsonb) from jsonb_array_elements(requested_questions->'questions') q;
  elsif not will_retry then
    insert into public.ticket_proposals(ticket_id,run_id,title,description,changes) select r.ticket_id,r.id,x->>'title',coalesce(x->>'description',''),coalesce(x->'changes','{}') from jsonb_array_elements(coalesce(requested_proposals,'[]')) x;
    if requested_findings is not null then update public.tickets set findings=(select string_agg('- '||(value#>>'{}'),E'\n') from jsonb_array_elements(requested_findings)),updated_at=now() where id=r.ticket_id and user_id=r.user_id; end if;
    if requested_findings is not null and jsonb_array_length(requested_findings) > 0 then
      update public.tickets set status='In Progress', updated_at=now() where id=r.ticket_id and user_id=r.user_id;
      insert into public.agent_run_outbox(run_id,attempt_id,event_type,payload) values(r.id,a.id,'queue_development',jsonb_build_object('userId',r.user_id,'ticketId',r.ticket_id)) on conflict do nothing;
    end if;
    if requested_queue_deployment then insert into public.agent_run_outbox(run_id,attempt_id,event_type,payload) values(r.id,a.id,'queue_deployment',jsonb_build_object('userId',r.user_id,'ticketId',r.ticket_id)) on conflict do nothing; end if;
  end if;
  update public.agent_runs set status=case when will_retry then 'queued' when blocked then 'blocked' when needs_input then 'waiting_for_input' else 'finished' end,
    interaction_rounds=interaction_rounds+case when needs_input then 1 else 0 end,active_attempt_id=null,
    worker_id=case when will_retry then null else worker_id end,finished_at=case when will_retry or needs_input then null else now() end,updated_at=now(),
    output=case when will_retry then output else coalesce(requested_output,output) end,error=case when blocked then 'Maximum human-input rounds exceeded.' when will_retry then null else requested_error end,
    logical_outcome=case when requested_failure_class='cancellation' then 'cancelled' else logical_outcome end,
    result_version=case when will_retry then result_version else requested_result_version end,canonical_result=case when will_retry then canonical_result else requested_canonical_result end where id=r.id;
  return jsonb_build_object('state','applied','retrying',will_retry,'needsInput',needs_input,'blocked',blocked,'requestId',request_id);
end; $$;
