-- Persist immutable, versioned execution contracts while leaving historical runs nullable.
alter table public.agent_runs
  add column job_type text,
  add column job_spec_version integer,
  add column permission_profile text,
  add column job_spec jsonb,
  add column result_version integer,
  add column canonical_result jsonb;

alter table public.agent_runs
  add constraint agent_runs_job_type_check check (
    job_type is null or job_type in ('refinement','development','review','testing','epic_breakout','deployment','column')
  ),
  add constraint agent_runs_job_spec_version_check check (job_spec_version is null or job_spec_version = 1),
  add constraint agent_runs_permission_profile_check check (
    permission_profile is null or permission_profile in ('repository_read','repository_write')
  ),
  add constraint agent_runs_job_spec_bundle_check check (
    (job_spec is null and job_type is null and job_spec_version is null and permission_profile is null)
    or
    coalesce((jsonb_typeof(job_spec) = 'object'
      and job_type is not null and job_spec_version = 1 and permission_profile is not null
      and job_spec->>'type' = job_type
      and job_spec->>'version' = job_spec_version::text
      and job_spec#>>'{permissions,profile}' = permission_profile), false)
  ),
  add constraint agent_runs_canonical_result_check check (
    (canonical_result is null and result_version is null)
    or
    coalesce((jsonb_typeof(canonical_result) = 'object' and result_version = 1
      and canonical_result->>'version' = result_version::text), false)
  );

create index agent_runs_job_type_status_idx
  on public.agent_runs (user_id, job_type, status, created_at desc)
  where job_spec is not null;

create or replace function public.protect_agent_run_job_spec()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.job_spec is not null and (
    new.job_spec is distinct from old.job_spec
    or new.job_type is distinct from old.job_type
    or new.job_spec_version is distinct from old.job_spec_version
    or new.permission_profile is distinct from old.permission_profile
  ) then
    raise exception 'Queued JobSpec execution metadata is immutable';
  end if;
  return new;
end;
$$;

create trigger agent_runs_protect_job_spec
before update on public.agent_runs
for each row execute function public.protect_agent_run_job_spec();

-- Executable runs are now created by authenticated server routes. Browser clients
-- retain read access for the existing queue UI but cannot insert or mutate runs.
drop policy if exists "Users manage their own agent runs" on public.agent_runs;
create policy "Users read their own agent runs"
  on public.agent_runs for select to authenticated
  using (auth.uid() = user_id);

-- New prompt snapshots describe the split of responsibilities. Existing rendered
-- prompts and historical jobs are intentionally untouched.
update public.column_agents
set instructions = 'Review the implementation against the work item, acceptance criteria, repository instructions, and existing architecture. Inspect source changes and report every actionable finding, or an empty findings array when the review is clean. Do not modify files or run build, lint, type-check, or test commands. The Runner executes deterministic verification and handles Git metadata after a clean review. Return JSON matching the provided schema.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}'
where column_name = 'In Review';

update public.column_agents
set instructions = 'Inspect the change and identify relevant test scenarios, coverage gaps, and release risks. Do not modify files or run build, lint, type-check, or test commands. The Runner is authoritative for deterministic verification results.' || E'\n\nWorkspace instructions:\n{{workspaceInstructions}}\n\nWork item:\n{{ticket}}\n\nRepository:\n{{repository}}\n\nRun context:\n{{runContext}}'
where column_name = 'In Testing';
