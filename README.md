# Flowboard

A bright, minimal Kanban board built with Next.js and Supabase, ready for Vercel.

## Run locally

```bash
npm install
npm run dev
```

Without environment variables, the app saves items in the browser. To use Supabase:

1. Create a Supabase project and run `supabase/migrations/001_create_tickets.sql` in the SQL editor.
2. In Supabase, open Authentication → Providers → Anonymous Sign-Ins and enable it.
3. Copy `.env.example` to `.env.local` and add the project URL and anon key.
4. Restart the development server.

## Deploy to Vercel

Import the repository in Vercel and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project environment variables.

The app creates an invisible anonymous session, so there is no login screen while row-level security still isolates each browser's tickets. Clearing browser data creates a new identity; add a permanent login method later if users need cross-device access or account recovery.
