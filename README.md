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
10. Copy `.env.example` to `.env.local` and add the project URL, publishable/anon key, and server-only service-role key.
11. In Authentication → URL Configuration, set the Site URL to your local or deployed URL and add any required redirect URLs.
12. Restart the development server and create your first account.

To use the interactive refinement agent, also set `OPENAI_API_KEY` in `.env.local`. `OPENAI_REFINEMENT_MODEL` is the fallback for requests without a saved agent model; new agents default to `gpt-5.6-luna`.

## Deploy to Vercel

Import the repository in Vercel and add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` to the project environment variables. Never expose the service-role key with a `NEXT_PUBLIC_` prefix.

Flowboard supports email/password sign-up, sign-in, password reset, persistent sessions, and sign-out. Row-level security isolates every user's tickets using `auth.uid()`.

## Column agents

Add repositories once through **GitHub repositories** in the header menu, then select the target repository and base branch on each ticket. **Column Setup** controls whether an agent may use every connected repository or only a selected subset. Manual runs and automatic column-entry runs are written to `agent_runs` with a `queued` status. A server-side worker and GitHub App authorization are required before queued agents can create branches or pull requests.

## Local Codex worker

The Vercel app queues work in Supabase. A worker on your computer polls the Vercel API and runs the Codex SDK in the matching local Git checkout; local Codex authentication never leaves your computer.

1. Apply migration `009_local_codex_workers.sql` in Supabase.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel and redeploy.
3. In Flowboard, open the workspace menu and choose **Local Codex worker**.
4. Create a worker token and copy the generated startup command.
5. Replace the example repository mapping with every repository the worker may use, for example:

```bash
FLOWBOARD_REPOSITORIES='{"jacqueDuBob/AgentWorkforce":"/Users/jakobdrees/AgentWorkforce"}'
```

6. Run the copied command from this project directory. Leave the process running while agents should execute.

The worker uses `workspace-write`, disables network access, and does not allow interactive approval prompts. Its token is displayed once; create a new token if it is lost.
