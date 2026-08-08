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
3. Copy `.env.example` to `.env.local` and add the project URL and publishable/anon key.
4. In Authentication → URL Configuration, set the Site URL to your local or deployed URL and add any required redirect URLs.
5. Restart the development server and create your first account.

## Deploy to Vercel

Import the repository in Vercel and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project environment variables.

Flowboard supports email/password sign-up, sign-in, password reset, persistent sessions, and sign-out. Row-level security isolates every user's tickets using `auth.uid()`.

## Column agents

Open the header menu and select **Column Setup**. Each workflow column has its own enabled state, instructions, manual or automatic start mode, and GitHub repository target. Manual runs and automatic column-entry runs are written to `agent_runs` with a `queued` status. A server-side worker and GitHub App authorization are required before queued agents can create branches or pull requests.
