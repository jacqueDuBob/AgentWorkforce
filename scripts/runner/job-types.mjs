export const JOB_TYPES = Object.freeze({
  REFINEMENT: "refinement",
  DEVELOPMENT: "development",
  REVIEW: "review",
  TESTING: "testing",
  EPIC_BREAKOUT: "epic_breakout",
  DEPLOYMENT: "deployment",
  COLUMN: "column",
});

// Historical-only: maps immutable pre-JobSpec run snapshots, which permanently carry
// the retired 13-column names, to a canonical job type. Never update this to the
// eight-column names; live columns use jobTypeForColumn in shared/job-contract.mjs.
export function mapLegacyJobType(run) {
  const kind = run?.kind || "column";
  if (kind === "refinement_questions" || kind === "refinement_rewrite") return JOB_TYPES.REFINEMENT;
  if (kind === "epic_breakout") return JOB_TYPES.EPIC_BREAKOUT;
  if (kind !== "column") return JOB_TYPES.COLUMN;
  if (run.column === "In Work") return JOB_TYPES.DEVELOPMENT;
  if (run.column === "In Review") return JOB_TYPES.REVIEW;
  if (run.column === "In Testing") return JOB_TYPES.TESTING;
  if (run.column === "In Deployment") return JOB_TYPES.DEPLOYMENT;
  return JOB_TYPES.COLUMN;
}

export function mapLegacyJobSubtype(run) {
  return run?.kind === "refinement_questions" ? "questions"
    : run?.kind === "refinement_rewrite" ? "rewrite"
      : undefined;
}
