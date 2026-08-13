# Flowboard Agent Instructions

These instructions apply to the entire repository. Keep changes narrow, preserve
unrelated user work, and prefer repository evidence over assumptions.

## Product and Architecture

Flowboard is a Next.js App Router application backed by Supabase. It has three
execution and trust boundaries:

- Browser UI and stores (`app/`, `components/`, `lib/*-store.ts`) use the
  publishable Supabase client and rely on authentication plus row-level security.
- Route handlers (`app/api/`) may use the server-only service-role client, but must
  authenticate the caller and enforce ownership explicitly because that client
  bypasses RLS.
- The local worker (`scripts/codex-worker.mjs`) polls authenticated worker routes,
  maps repository identifiers to approved local checkouts, and runs Codex inside
  the configured sandbox.

The ticket store also supports a no-Supabase development mode using browser local
storage. Agent execution, authentication, repositories, and other collaborative
features require Supabase. Preserve this distinction unless the task changes it.

## Before Changing Code

- Read the complete path affected by the change: component, store, shared type,
  route handler, worker contract, and migration where applicable.
- Check `git status` and relevant diffs before editing. Existing modifications are
  user work; do not discard, rewrite, or "clean up" unrelated changes.
- Search for all readers and writers before changing a persisted field, run status,
  prompt variable, API payload, or shared type.
- State assumptions when code, migrations, and documentation do not settle a
  decision. Do not silently invent compatibility requirements.

## Application Conventions

- Use strict TypeScript for application code and the existing `@/` import alias.
  The worker remains an ES module (`.mjs`) unless a deliberate migration changes it.
- Follow App Router boundaries. Add `"use client"` only where browser APIs, hooks,
  or interactive state require it; keep privileged modules server-only.
- Reuse existing components, stores, prompt helpers, and domain types before adding
  another abstraction or a parallel data-access path.
- Keep database row-to-domain and domain-to-row mappings explicit. When a persisted
  field changes, update both directions, validation/default handling, and every
  affected API/worker payload.
- Preserve stable IDs, ordering, and immutable state updates in Kanban interactions.
  Do not make optimistic UI updates that cannot be reconciled after persistence
  fails.
- Keep user-facing errors actionable while avoiding secrets, raw credentials, or
  unnecessary backend details.

## Authentication and Data Safety

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, worker tokens, local paths, Codex
  credentials, or `.env*` contents. Only the Supabase URL and anon/publishable key
  may use the `NEXT_PUBLIC_` prefix.
- Import privileged helpers from server-only modules. Do not pull
  `lib/supabase-admin.ts`, `lib/server-auth.ts`, or `lib/worker-auth.ts` into a
  client component or browser bundle.
- Every service-role route must authenticate before data access. Scope every query
  and mutation to the authenticated user's `user_id` or to another ownership link
  proven in the same request; never trust a body, URL, repository, ticket, run, or
  worker ID by itself.
- Keep browser operations compatible with RLS. A client-side filter is not an
  authorization control; policy changes belong in a migration.
- Worker tokens are bearer credentials: store only their hashes, return plaintext
  only at creation, honor revocation, and require the authenticated worker to own
  any claimed or completed run.
- Validate untrusted JSON and return appropriate 4xx responses for invalid input or
  authorization failures. Reserve 5xx responses for server/integration failures.

## Supabase Migrations

- Add schema or policy changes as a new, sequentially numbered file under
  `supabase/migrations/`. Never edit, reorder, or reuse an existing migration number
  that may have been applied.
- Make migrations safe for the repository's supported upgrade path. Qualify public
  objects, enable RLS on user-facing tables, and define policies/grants explicitly.
- Treat `security definer` functions as privileged code: set a safe `search_path`,
  constrain grants, and validate ownership/role assumptions inside the function.
- Update application mappings and types in the same change as the schema. Update
  setup documentation when operators must apply a migration or configure a new
  environment variable.
- Review migrations for cross-user data exposure, destructive backfills, lock risk,
  and behavior for both existing and newly created users.

## Agent Queue and Local Worker

- Treat `rendered_prompt` as an immutable execution snapshot. Render and store the
  complete prompt before queueing; workers must execute that snapshot rather than
  reconstructing it from mutable settings.
- Preserve the queue lifecycle and ownership checks across claim and finish. A run
  may only be completed by the worker that claimed it, and retries must not duplicate
  downstream effects.
- Keep repository access allowlisted twice: by the application configuration and by
  `FLOWBOARD_REPOSITORIES` on the worker. Resolve configured paths and verify the
  checkout; never derive a filesystem path directly from request data.
- Preserve least privilege: refinement and Epic breakout jobs are read-only; write
  jobs use `workspace-write`; network access and interactive approvals remain off
  unless the user explicitly requests and justifies a security-model change.
- When changing a job kind or result format, update its schema, queue producer,
  claim response, worker execution, finish handler, UI consumer, and failure path
  together.
- Do not infer successful repository operations from a generic natural-language
  response. Preserve or strengthen the explicit completion signal contract.

## Verification

Choose checks by impact and report exactly what ran:

- Any code change: run `npm run lint`.
- Changes to behavior, types, routes, worker contracts, configuration, dependencies,
  or deployment: also run `npm run build`.
- Worker changes: additionally run `node --check scripts/codex-worker.mjs` and test
  the affected request/result path without printing tokens.
- Migration changes: inspect the full migration in order and, when a disposable
  Supabase environment is available, test both a fresh apply and an upgrade from the
  previous migration. Explicitly report when database verification is unavailable.
- Documentation-only changes: run `git diff --check`; code checks are optional unless
  the documentation reflects a code or configuration change that also needs proof.

There is no substitute for targeted manual verification of the changed behavior.
For UI work, check loading, empty, success, and error states plus keyboard and narrow
viewport behavior. Never claim a check passed if it was skipped, blocked, or failed.

## Definition of Done

A task is complete only when the requested behavior is implemented across every
affected boundary, relevant checks pass, security and failure paths have been
considered, and setup or behavior documentation is current. Report changed files,
verification results, important assumptions, and any remaining risk or unverified
step; do not hide known task-related issues.

## Maintaining This File

Keep this file as durable repository policy, not task memory. Add a rule only when
it is supported by the codebase or explicitly established by the user. Do not add
timestamps, ticket details, temporary workarounds, speculative architecture, or a
work log. Keep future edits concise and mention material policy changes in the final
summary.
