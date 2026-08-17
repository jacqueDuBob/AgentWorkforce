import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { jobTypeForColumn } from "../../shared/job-contract.mjs";
import { mapLegacyJobType } from "../../scripts/runner/job-types.mjs";

const MIGRATION_PATH = new URL("../../supabase/migrations/025_eight_column_consolidation.sql", import.meta.url);
const TYPES_PATH = new URL("../../lib/types.ts", import.meta.url);

async function migrationText() {
  return readFile(MIGRATION_PATH, "utf8");
}

function parseStringArray(source, exportName) {
  const match = source.match(new RegExp(`export const ${exportName} = \\[([\\s\\S]*?)\\] as const;`));
  assert.ok(match, `expected to find ${exportName} in lib/types.ts`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

async function loadColumns() {
  const source = await readFile(TYPES_PATH, "utf8");
  return { columns: parseStringArray(source, "COLUMNS"), legacyColumns: parseStringArray(source, "LEGACY_COLUMNS") };
}

test("the board has exactly the eight canonical columns in order", async () => {
  const { columns } = await loadColumns();
  assert.deepEqual(columns, [
    "Inbox", "Refinement", "Ready", "In Progress", "Review", "Validation", "Ready to Deploy", "Live",
  ]);
  assert.equal(columns.length, 8);
  assert.equal(new Set(columns).size, 8);
});

test("legacy columns are preserved for reading historical evidence only", async () => {
  const { legacyColumns } = await loadColumns();
  assert.equal(legacyColumns.length, 13);
  for (const column of ["New", "In Refinement", "In Work", "Work Completed", "In Review", "Review Completed", "In Testing", "Testing Completed", "In Deployment", "Deployed", "Ready for Live"]) {
    assert.ok(legacyColumns.includes(column));
  }
});

test("jobTypeForColumn maps every specialized new column and defaults the rest to generic column jobs", () => {
  assert.equal(jobTypeForColumn("In Progress"), "development");
  assert.equal(jobTypeForColumn("Review"), "review");
  assert.equal(jobTypeForColumn("Validation"), "testing");
  assert.equal(jobTypeForColumn("Ready to Deploy"), "deployment");
  for (const generic of ["Inbox", "Ready", "Live"]) assert.equal(jobTypeForColumn(generic), "column");
});

test("renamed specialized columns never silently fall back to a generic job", () => {
  const specialized = { "In Progress": "development", "Review": "review", "Validation": "testing", "Ready to Deploy": "deployment" };
  for (const [column, expected] of Object.entries(specialized)) {
    assert.notEqual(jobTypeForColumn(column), "column");
    assert.equal(jobTypeForColumn(column), expected);
  }
});

test("the legacy job-type mapper still maps immutable historical run snapshots", () => {
  assert.equal(mapLegacyJobType({ kind: "column", column: "In Work" }), "development");
  assert.equal(mapLegacyJobType({ kind: "column", column: "In Review" }), "review");
  assert.equal(mapLegacyJobType({ kind: "column", column: "In Testing" }), "testing");
  assert.equal(mapLegacyJobType({ kind: "column", column: "In Deployment" }), "deployment");
});

test("migration 025 rewrites tickets/column_agents constraints to the eight-column set", async () => {
  const migration = await migrationText();
  assert.match(migration, /drop constraint if exists tickets_status_check/);
  assert.match(migration, /drop constraint if exists column_agents_column_name_check/);
  const columnList = "'Inbox', 'Refinement', 'Ready', 'In Progress', 'Review', 'Validation', 'Ready to Deploy', 'Live'";
  const occurrences = migration.split(columnList).length - 1;
  assert.ok(occurrences >= 2, "expected the new eight-column list on both the tickets and column_agents constraints");
});

test("migration 025 documents every old-to-new ticket status mapping with deterministic merge ordering", async () => {
  const migration = await migrationText();
  const expectedMapping = {
    New: ["Inbox", 0], "In Refinement": ["Refinement", 1], Ready: ["Ready", 2], "In Work": ["In Progress", 3],
    "Work Completed": ["Review", 4], "In Review": ["Review", 5], "Review Completed": ["Validation", 6], "In Testing": ["Validation", 7],
    "Testing Completed": ["Ready to Deploy", 8], "In Deployment": ["Ready to Deploy", 9],
    Deployed: ["Live", 10], "Ready for Live": ["Live", 11], Live: ["Live", 12],
  };
  for (const [oldStatus, [newStatus, rank]] of Object.entries(expectedMapping)) {
    assert.match(migration, new RegExp(`\\('${oldStatus}', '${newStatus}', ${rank}\\)`), `expected mapping row for ${oldStatus}`);
  }
  // Historical tickets that were already deployed must never move backward into Ready to Deploy.
  assert.doesNotMatch(migration, /\('Deployed', 'Ready to Deploy'/);
  assert.doesNotMatch(migration, /\('Ready for Live', 'Ready to Deploy'/);
  assert.match(migration, /row_number\(\) over \(partition by t\.user_id, m\.new_status order by m\.old_rank, t\.position, t\.id\)/);
});

test("migration 025 never queues agents, attempts, or other workflow side effects while migrating tickets", async () => {
  const migration = await migrationText();
  const ticketMigrationSection = migration.split("-- 4. Migrate column-agent configuration")[0];
  assert.doesNotMatch(ticketMigrationSection, /insert into public\.agent_runs/);
  assert.doesNotMatch(ticketMigrationSection, /insert into public\.agent_run_attempts/);
  assert.doesNotMatch(ticketMigrationSection, /insert into public\.agent_run_outbox/);
});

test("migration 025 preserves discarded column-agent configuration in an archive and prefers the documented winners", async () => {
  const migration = await migrationText();
  assert.match(migration, /create table public\.column_agent_archive/);
  assert.match(migration, /__migrate_column_agent_group\('Review', array\['In Review', 'Work Completed'\]\)/);
  assert.match(migration, /__migrate_column_agent_group\('Validation', array\['In Testing', 'Review Completed'\]\)/);
  assert.match(migration, /__migrate_column_agent_group\('Ready to Deploy', array\['In Deployment', 'Testing Completed', 'Deployed', 'Ready for Live'\]\)/);
  // The one-time helper function must not remain in the schema after migration.
  assert.match(migration, /drop function public\.__migrate_column_agent_group\(text, text\[\]\)/);
});

test("migration 025 renames direct 1:1 columns without touching start_mode or enabled state", async () => {
  const migration = await migrationText();
  assert.match(migration, /update public\.column_agents set column_name = 'Inbox', updated_at = now\(\) where column_name = 'New'/);
  assert.match(migration, /update public\.column_agents set column_name = 'Refinement', updated_at = now\(\) where column_name = 'In Refinement'/);
  assert.match(migration, /update public\.column_agents set column_name = 'In Progress', updated_at = now\(\) where column_name = 'In Work'/);
  assert.doesNotMatch(migration, /set start_mode/);
  assert.doesNotMatch(migration, /set enabled/);
});

test("migration 025 seeds default agents for all eight columns without overwriting existing configuration", async () => {
  const migration = await migrationText();
  const { columns } = await loadColumns();
  for (const column of columns) assert.match(migration, new RegExp(`\\('${column}', '`));
  assert.match(migration, /on conflict \(column_name\) do nothing/);
});

test("migration 025 extends the outbox for the review-findings requeue without breaking deployment dedup", async () => {
  const migration = await migrationText();
  assert.match(migration, /check \(event_type in \('queue_deployment', 'queue_development'\)\)/);
  assert.match(migration, /status='In Progress'/);
  assert.match(migration, /'queue_development',jsonb_build_object\('userId',r\.user_id,'ticketId',r\.ticket_id\)\) on conflict do nothing/);
  assert.match(migration, /'queue_deployment',jsonb_build_object\('userId',r\.user_id,'ticketId',r\.ticket_id\)\) on conflict do nothing/);
});

test("migration 025 does not rewrite historical immutable job_spec or canonical_result columns", async () => {
  const migration = await migrationText();
  assert.doesNotMatch(migration, /update public\.agent_runs\s+set job_spec/);
  assert.doesNotMatch(migration, /update public\.agent_runs\s+set canonical_result/);
});

test("server queue service uses the new column names for Refinement and Ready to Deploy", async () => {
  const queue = await readFile(new URL("../../lib/server-job-queue.ts", import.meta.url), "utf8");
  assert.match(queue, /loadAgent\("Refinement"\)/);
  assert.match(queue, /loadAgent\("Ready to Deploy"\)/);
  assert.doesNotMatch(queue, /loadAgent\("In Refinement"\)/);
  assert.doesNotMatch(queue, /loadAgent\("In Deployment"\)/);
  assert.match(queue, /requeueDevelopmentAfterFindings/);
  assert.match(queue, /queue_development/);
});
