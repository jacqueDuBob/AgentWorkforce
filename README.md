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
6. Copy `.env.example` to `.env.local` and add the project URL and publishable/anon key.
7. In Authentication → URL Configuration, set the Site URL to your local or deployed URL and add any required redirect URLs.
8. Restart the development server and create your first account.

To use the interactive refinement agent, also set `OPENAI_API_KEY` in `.env.local`. `OPENAI_REFINEMENT_MODEL` is the fallback for requests without a saved agent model; new agents default to `gpt-5.6-luna`.

## Deploy to Vercel

Import the repository in Vercel and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project environment variables.

Flowboard supports email/password sign-up, sign-in, password reset, persistent sessions, and sign-out. Row-level security isolates every user's tickets using `auth.uid()`.

## Column agents

Add repositories once through **GitHub repositories** in the header menu, then select the target repository and base branch on each ticket. **Column Setup** controls whether an agent may use every connected repository or only a selected subset. Manual runs and automatic column-entry runs are written to `agent_runs` with a `queued` status. A server-side worker and GitHub App authorization are required before queued agents can create branches or pull requests.
