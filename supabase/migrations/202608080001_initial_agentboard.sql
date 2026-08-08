-- AgentBoard initial vertical-slice schema
create extension if not exists pgcrypto;

create table if not exists owner_profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists repositories (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references owner_profiles(id) on delete cascade,
  github_repository_id text,
  full_name text not null,
  default_branch text not null default 'main',
  installation_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_profile_id, full_name)
);

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references owner_profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  key text not null,
  version text not null,
  created_at timestamptz not null default now(),
  unique(board_id, key, version)
);

create table if not exists workflow_stages (
  id uuid primary key default gen_random_uuid(),
  workflow_definition_id uuid not null references workflow_definitions(id) on delete cascade,
  stage_id text not null,
  label text not null,
  order_index integer not null,
  created_at timestamptz not null default now(),
  unique(workflow_definition_id, stage_id),
  unique(workflow_definition_id, order_index)
);

create table if not exists transition_policies (
  id uuid primary key default gen_random_uuid(),
  workflow_definition_id uuid not null references workflow_definitions(id) on delete cascade,
  from_stage_id text not null,
  to_stage_id text not null,
  mode text not null check (mode in ('automatic', 'manual', 'conditional')),
  condition jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workflow_definition_id, from_stage_id, to_stage_id)
);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  repository_id uuid references repositories(id) on delete set null,
  title text not null,
  description text not null,
  stage_id text not null,
  classification jsonb,
  specialization_tags text[] not null default '{}',
  auto_review_loop_count integer not null default 0,
  manual_remediation_credits integer not null default 0,
  remediation_attempt_count integer not null default 0,
  review_cycle_count integer not null default 0,
  blocked_reason text,
  merge_approved_at timestamptz,
  token_usage integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (auto_review_loop_count >= 0),
  check (manual_remediation_credits >= 0)
);

create table if not exists card_artifacts (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  run_id uuid,
  artifact_type text not null,
  label text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists agent_definitions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  role text not null,
  version text not null,
  prompt text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique(board_id, role, version)
);

create table if not exists specialization_profiles (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  repository_id uuid references repositories(id) on delete set null,
  profile_type text not null check (profile_type in ('language', 'framework', 'technical_concern', 'repository_guidance')),
  name text not null,
  guidance text not null,
  created_at timestamptz not null default now()
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  role text not null,
  stage_id text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  prompt_version text not null,
  cycle_number integer not null default 0,
  token_usage integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  output_summary text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists review_cycles (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  cycle_number integer not null,
  unresolved_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique(card_id, cycle_number)
);

create table if not exists review_findings (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  cycle_number integer not null,
  stable_id text not null,
  severity text not null check (severity in ('informational', 'low', 'medium', 'high', 'critical')),
  category text not null,
  title text not null,
  description text not null,
  evidence text not null,
  file_path text,
  line_number integer,
  required_outcome text not null,
  status text not null check (status in ('open', 'resolved', 'dismissed')),
  resolution_evidence text,
  resolution_commit text,
  dismissal_justification text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(card_id, stable_id, cycle_number),
  check ((status <> 'dismissed') or (dismissal_justification is not null))
);

create table if not exists test_runs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  cycle_number integer not null,
  status text not null check (status in ('passed', 'failed')),
  mandatory_checks_passed boolean not null,
  evidence text not null,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  kind text not null check (kind in ('remediation', 'merge')),
  approved boolean not null,
  justification text not null,
  actor_type text not null,
  actor_id text not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists github_operations (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  operation_type text not null,
  status text not null check (status in ('pending', 'completed', 'failed')),
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists usage_cost_records (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  run_id uuid references agent_runs(id) on delete set null,
  model text not null,
  token_usage integer not null,
  estimated_cost_usd numeric(12,6) not null,
  created_at timestamptz not null default now()
);

create table if not exists workflow_transition_audit (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  from_stage_id text not null,
  to_stage_id text not null,
  decision text not null check (decision in ('allowed', 'blocked')),
  reason text not null,
  idempotency_key text not null,
  actor_type text not null,
  actor_id text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  unique(card_id, idempotency_key)
);

create table if not exists durable_jobs (
  id bigint generated by default as identity primary key,
  queue_name text not null,
  payload jsonb not null,
  status text not null default 'queued',
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(queue_name, idempotency_key)
);
