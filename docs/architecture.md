# AgentBoard MVP Architecture

## Boundaries
- Vercel/Next.js hosts UI, API, webhook endpoints, and workflow coordination.
- Supabase Postgres is the source of record for workflow and audit tables.
- GitHub is source of truth for repository objects and merge state.
- GitHub Actions is the isolated worker for repository execution.
- OpenAI Responses API is behind a model adapter and never exposed client-side.

## Core Modules
- `src/lib/domain`: state machine, transition policies, review-loop invariants.
- `src/lib/store`: demo-mode persistence and mutation orchestration.
- `src/lib/providers/github`: provider abstraction, demo provider, app provider foundation, signature verification.
- `src/lib/providers/models`: provider abstraction, deterministic demo provider, OpenAI Responses implementation.
- `src/app/api`: server routes for board, cards, transitions, approvals, findings, policies, and webhook endpoint.
- `src/components/agentboard.tsx`: command-center UI and route integration.

## Policy Model
Each stage edge has a transition policy with mode (`automatic`, `manual`, `conditional`) and a condition payload. The workflow engine enforces policy conditions and loop limits before state mutation.

## Review Loop Invariants
- Any unresolved finding blocks testing.
- Automatic review remediation loops stop after three transitions.
- Additional remediation attempts require one approval per attempt.
- Merge transition is blocked without explicit human merge approval.
- Idempotency keys are stored to prevent duplicate transitions/jobs.
