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
12. Copy `.env.example` to `.env.local` and add the project URL, publishable/anon key, and server-only service-role key.
13. In Authentication → URL Configuration, set the Site URL to your local or deployed URL and add any required redirect URLs.
14. Restart the development server and create your first account.

## Deploy to Vercel

Import the repository in Vercel and add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` to the project environment variables. Never expose the service-role key with a `NEXT_PUBLIC_` prefix.

Flowboard supports email/password sign-up, sign-in, password reset, persistent sessions, and sign-out. Row-level security isolates every user's tickets using `auth.uid()`.

## Column agents

Add repositories once through **GitHub repositories** in the header menu, then select the target repository and base branch on each ticket. **Column Setup** controls prompts and whether an agent may use every connected repository or only a selected subset. Manual and automatic runs render the selected column prompt with ticket context and store the complete snapshot on `agent_runs` before queuing.

The **In Work** agent implements changes on a non-base branch and leaves them uncommitted. The **In Review** agent records actionable issues in the ticket's Findings field without committing. When review is clean, it commits and pushes the current branch; only that successful review push can queue automatic deployment. Move a ticket with findings back to **In Work** to run the implementation agent with those findings included in its prompt.

## Local Codex worker

The Vercel app queues work in Supabase. A worker on your computer polls the Vercel API and runs the Codex SDK in the matching local Git checkout; local Codex authentication never leaves your computer.

1. Apply all migrations through `015_review_findings_and_push.sql` in Supabase.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel and redeploy.
3. In Flowboard, open the workspace menu and choose **Local Codex worker**.
4. Create a worker token and copy the generated startup command.
5. Replace the example repository mapping with every repository the worker may use, for example:

```bash
FLOWBOARD_REPOSITORIES='{"jacqueDuBob/AgentWorkforce":"/Users/jakobdrees/AgentWorkforce"}'
```

6. Run the copied command from this project directory. Leave the process running while agents should execute.

The worker disables network access and interactive approval prompts. Repository-aware refinement and Epic breakout runs use a read-only sandbox; other column runs use `workspace-write`. Its token is displayed once; create a new token if it is lost.
