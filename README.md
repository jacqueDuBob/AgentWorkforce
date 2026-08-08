# AgentBoard (MVP Vertical Slice)

AgentBoard is a single-user AI-workforce Kanban command center for software delivery tasks.

This repository implements the first production-style vertical slice with:
- Stateful workflow engine (not orchestration-agent driven)
- Policy-driven transitions (`automatic`, `manual`, `conditional`)
- Review loop controls (3 automatic loops + one manual-approval credit per extra attempt)
- Findings, approvals, run history, artifacts, and cost tracking
- Server-side GitHub integration foundations and webhook signature verification
- OpenAI Responses adapter

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env.local
```

3. Configure environment variables and run the app:
```bash
npm run dev
```

4. Open http://localhost:3000

## Verification

Run all checks:
```bash
npm run check
```

Or individually:
```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## Features in this slice

- Responsive command-center Kanban board
- Drag-and-drop when policy allows transition
- Card create/edit and repository association
- Structured classification output model
- Development/Review/Test run records with artifacts
- Findings grouped by severity and status
- Automatic remediation loops on unresolved findings (including informational/low)
- Block after three automatic loops until manual remediation approval
- Exactly one additional remediation attempt per approval
- Merge blocked until explicit merge approval is recorded
- Transition policy dropdowns persisted in domain state
- Workflow timeline with transition audit logs

## Project Structure

- `src/lib/domain`: Workflow state machine and invariants
- `src/lib/store`: Supabase persistence and seed state
- `src/lib/providers/github`: GitHub App provider + webhook verification
- `src/lib/providers/models`: OpenAI Responses provider
- `src/app/api`: Board/cards/policies/approval/webhook routes
- `src/components/agentboard.tsx`: Command-center UI
- `supabase/migrations`: SQL schema
- `supabase/seed`: Seed SQL
- `docs`: Architecture and setup notes

## Supabase Setup

Use the migration and seed SQL files:
- `supabase/migrations/202608080001_initial_agentboard.sql`
- `supabase/seed/seed.sql`

Set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and the GitHub App credentials in your deployment environment. The app uses the normalized Supabase tables as the source of truth.

## GitHub App Setup (least privilege)

Recommended repository permissions:
- Contents: Read & write
- Pull requests: Read & write
- Actions: Read
- Checks: Read

Required env:
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_WEBHOOK_SECRET`

Workflow runner contract:
- `.github/workflows/agentboard-runner.yml`

## OpenAI Setup

Required env:
- `OPENAI_API_KEY`

Configurable:
- `OPENAI_CLASSIFIER_MODEL`
- `OPENAI_TIMEOUT_MS`

## Known Limitations

- GitHub worker callback ingestion is scaffolded via webhook verification endpoint; full callback mapping is a next milestone.
- Cost estimation uses simplified token pricing heuristics.

## Next Milestones

1. Add pgmq-backed durable queue dispatcher for long-running workflow jobs.
2. Complete GitHub callback/event projection into run and operation records.
3. Add richer policy condition editor and repository-specific specialization governance.
