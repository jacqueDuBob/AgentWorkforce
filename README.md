# Flowboard

A bright, minimal Kanban board built with Next.js and Supabase, ready for Vercel.

## Run locally

```bash
npm install
npm run dev
```

The app requires a Supabase project for authentication and board storage:

1. Create a Supabase project and run `supabase/migrations/001_create_tickets.sql` in the SQL editor.
2. Run `supabase/migrations/002_add_column_agents.sql` to add column-agent configuration and the execution queue.
3. Run `supabase/migrations/003_refactor_repositories.sql` to add workspace repositories and ticket-level repository selection.
4. Run `supabase/migrations/004_add_agent_models.sql` to add per-agent model configuration and run-level model history.
5. Run `supabase/migrations/005_add_workspace_instructions.sql` to add the canonical master instructions shared by agents.
6. Run `supabase/migrations/006_agent_run_lifecycle.sql` to add agent-run lifecycle tracking.
7. Run `supabase/migrations/007_acceptance_criteria_items.sql` to store acceptance criteria as individually tracked items.
8. Run `supabase/migrations/008_epic_breakout_sessions.sql` to add Epic recommendations, breakout-session history, and draft child-ticket relationships.
9. Run `supabase/migrations/009_local_codex_workers.sql` to add secure local-worker credentials and claims.
10. Run `supabase/migrations/010_database_prompt_templates.sql` to store all agent prompts in the database and snapshot rendered queue prompts.
11. Run `supabase/migrations/011_codex_refinement_runs.sql` to add prioritized, repository-aware Codex refinement jobs.
12. Run migrations `012_codex_epic_breakout_runs.sql` through `017_ticket_conversations_notifications.sql` in numerical order.
13. If migration 014 was previously applied before migration 013, run `018_repair_deployment_and_worker_git.sql` instead of replaying migration 013 against the newer schema.
14. Run `019_ticket_collaboration_hardening.sql` through `024_repository_candidate_handoff.sql` in numerical order to add versioned jobs, leased attempts, suspended human-input rounds, and durable Git-native repository candidates.
15. Run `025_eight_column_consolidation.sql` to consolidate the board into the eight canonical columns (Inbox, Refinement, Ready, In Progress, Review, Validation, Ready to Deploy, Live), migrating existing tickets and column agents in place; use `validate_migration_025.sql` to check the result.
16. Copy `.env.example` to `.env.local` and add the project URL, publishable/anon key, and server-only service-role key.
17. In Authentication → URL Configuration, set the Site URL to your local or deployed URL and add any required redirect URLs.
18. Restart the development server and create your first account.

For an existing deployment, deploy the application code before applying migration 020. The server temporarily falls back to legacy-compatible queue rows when the new columns are absent; once migration 020 is applied, new rows automatically use immutable JobSpecs and browser-side run mutation is disabled. Apply migrations 021 and 022 together with the capability-advertising worker: workers from before Phase 2C are intentionally ineligible for leased jobs and receive an upgrade-required response instead of claiming work they cannot finish.

## Deploy to Vercel

Import the repository in Vercel and add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` to the project environment variables. Never expose the service-role key with a `NEXT_PUBLIC_` prefix.

Flowboard supports email/password sign-up, sign-in, password reset, persistent sessions, and sign-out. Row-level security isolates every user's tickets using `auth.uid()`.

## Column agents

The board has eight columns: **Inbox**, **Refinement**, **Ready**, **In Progress**, **Review**, **Validation**, **Ready to Deploy**, and **Live**. Add repositories once through **GitHub repositories** in the header menu, then select the target repository and base branch on each ticket. **Column Setup** controls every column's agent name, model, instructions, enabled state, manual/automatic start mode, and repository-access policy; **Refinement** additionally exposes its specialized questions, rewrite, and Epic breakout prompts. Manual and automatic runs render the selected column prompt with ticket context and store the complete snapshot on `agent_runs` before queuing.

The local worker creates a non-base ticket branch before the **In Progress** agent implements changes and leaves them uncommitted. The **Review** agent records actionable issues in the ticket's Findings field without committing. A clean review is required to have a published repository candidate; the worker then commits and pushes the current branch, and only that successful push can queue automatic deployment. A review with findings never queues deployment: the ticket automatically returns to **In Progress** with its findings retained, and a new development attempt is queued only if the In Progress agent's start mode is automatic (otherwise it waits for a manual run), without creating duplicate jobs on retries.

Runner job types are unchanged and map from the eight columns as follows: **In Progress** → `development`, **Review** → `review`, **Validation** → `testing`, **Ready to Deploy** → `deployment`; **Inbox**, **Ready**, and **Live** run the generic `column` job type with a configurable but not specialized agent.

## Local Codex worker

The Vercel app queues work in Supabase. A worker on your computer polls the Vercel API and runs the Codex SDK in the matching local Git checkout; local Codex authentication never leaves your computer.

1. Apply all migrations through `025_eight_column_consolidation.sql` in Supabase.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel and redeploy.
3. In Flowboard, open the workspace menu and choose **Local Codex worker**.
4. Create a worker token and copy the generated startup command.
5. Replace the example repository mapping with every repository the worker may use, for example:

```bash
FLOWBOARD_REPOSITORIES='{"jacqueDuBob/AgentWorkforce":"/Users/jakobdrees/AgentWorkforce"}'
```

6. Run the copied command from this project directory. Leave the process running while agents should execute.

The worker disables network access and interactive approval prompts. Repository-aware refinement, Epic breakout, and review runs use a read-only sandbox; development and other existing column runs retain `workspace-write`. Its token is displayed once; create a new token if it is lost.

Each poll advertises the worker's supported contract versions, job types, agent adapters, workspace provider, repository allowlist, and runtime features. Compatible claims create a 90-second database-timed lease; the worker heartbeats every 30 seconds. Expired attempts retain their evidence and are retried only within the configured attempt limit. Completion requests are idempotent, and deployment creation is protected by a transactional outbox plus a database deduplication key.

When an agent needs clarification, its attempt ends as `needs_input` and the logical job remains suspended. Structured questions and immutable answer events are shown in the ticket conversation. Submitting all answers makes the same job resumable; the next leased attempt receives an audited deterministic continuation snapshot and may optionally resume its provider session. Configure a scheduler to `POST /api/internal/runner-outbox` with `Authorization: Bearer $FLOWBOARD_OUTBOX_SECRET` so outbox delivery does not depend on worker polling; use a random secret of at least 32 characters.

Development, Review, and Testing attempts use disposable Git worktrees. Successful Development verification is followed by a Runner-owned commit and non-force push to `flowboard/<ticket-id>`; the exact base SHA, candidate SHA, branch, changed files, predecessor, and publication evidence are persisted before completion. Review and Testing bind that candidate at claim time and reconstruct a fresh workspace at its exact SHA. Review remains read-only and reports findings against the persisted base-to-candidate diff. Apply migration 024 and deploy its worker/API changes together; pre-2E Review rows without a durable candidate fail explicitly instead of inspecting an unrelated checkout.

Candidate commits include stable `Flowboard-Job` and `Flowboard-Attempt` trailers. Retrying publication within one attempt reuses the existing commit, candidate RPC retries return the row uniquely bound to that attempt, and completion retries do not republish Git state. Branch pushes are deliberately non-force, so a stale sibling commit cannot overwrite a newer candidate; the database additionally compares the attempt's assigned predecessor with the locked candidate head. A prolonged database outage after a successful push but before candidate persistence remains recoverable operational work and is never treated as authority to replace the recorded head.

Development, review, and testing jobs run deterministic verification through the Runner. New jobs snapshot their exact server-owned verification plan when queued. Historical jobs without a persisted JobSpec retain legacy discovery of `lint`, `typecheck`/`type-check`, `test`, and `build` from committed `HEAD:package.json`. Checks run in a temporary source snapshot so generated files do not mutate the checkout. Review agents receive read-only repository access; deterministic review checks and Git operations remain Runner-owned.

Set the same application-owned `FLOWBOARD_VERIFICATION_PLANS` JSON map on the Flowboard server and local worker. The server snapshots matching definitions into new JobSpecs; the worker uses its copy only for legacy rows. Commands use executable and argument arrays and never a shell string or agent output. Example:

```json
{"owner/repository":{"checks":[{"id":"unit","executable":"cargo","args":["test"],"timeoutMs":600000,"jobTypes":["development","review","testing"]}]}}
```
