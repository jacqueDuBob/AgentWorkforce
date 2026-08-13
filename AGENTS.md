# Agent Instructions

## Project

This repository contains Flowboard, a Next.js and Supabase Kanban application that coordinates repository-aware Codex agents and local workers.

## Working Principles

- Understand the relevant code path before making changes.
- Preserve existing behavior unless the task explicitly requires changing it.
- Keep changes focused on the requested outcome and avoid unrelated refactors.
- Treat existing user changes as intentional. Do not overwrite or revert them.
- Never expose secrets, service-role keys, worker tokens, or local credentials.
- State important assumptions when repository evidence does not resolve them.

## Project Conventions

- Use TypeScript for application code and follow the existing Next.js patterns.
- Reuse existing components, stores, and types before introducing new abstractions.
- Keep server-only Supabase access and secrets out of client-side code.
- Add database changes as new, ordered files under `supabase/migrations/`; do not rewrite migrations that may already have been applied.
- Keep repository-aware worker behavior compatible with the sandbox and authorization boundaries described in `README.md`.

## Verification

- Run `npm run lint` after code changes.
- Run `npm run build` when changes affect application behavior, types, routing, configuration, or deployment.
- Report which checks ran and disclose any checks that could not run or did not pass.

## Definition of Done

A task is complete when the requested behavior is implemented, relevant checks pass, documentation is updated when behavior or setup changes, and no known task-related issue remains hidden.

## Maintaining This File

- Treat this file as durable project guidance, not as task memory or a work log.
- Update it only when work reveals a verified, reusable repository rule or when the user changes project policy.
- Do not add temporary state, speculative conclusions, timestamps, ticket-specific details, or one-off implementation notes.
- Keep additions concise and consistent with higher-priority instructions.
- Mention material changes to this file in the final task summary.
