# Setup

## 1. Install dependencies
```bash
npm install
```

## 2. Configure environment
Copy `.env.example` to `.env.local` and set values.

## 3. Demo mode (default)
Set `AGENTBOARD_DEMO_MODE=true` for deterministic no-cost local workflow.

## 4. Supabase
- Create a Supabase project.
- Apply migrations in `supabase/migrations`.
- Apply seed file `supabase/seed/seed.sql`.
- Provide URL, anon key, and service role key in env.

## 5. GitHub App
- Create a GitHub App with least privilege:
  - Repository permissions: Contents (read/write), Pull requests (read/write), Actions (read), Checks (read).
  - Subscribe to workflow_run, check_suite, pull_request webhooks.
- Install the app on selected repositories.
- Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_SECRET`.

## 6. OpenAI
- Set `OPENAI_API_KEY` and optional model IDs.

## 7. Run
```bash
npm run dev
```

## 8. Verify quality
```bash
npm run check
```

## 9. Vercel deployment
- Add all environment variables to project settings.
- Keep service-role keys server-side only.
- Deploy as standard Next.js app.
