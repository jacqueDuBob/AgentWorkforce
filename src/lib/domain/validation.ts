import { z } from "zod";
import { APPROVAL_KINDS, FINDING_SEVERITIES, FINDING_STATUSES, POLICY_MODES, STAGE_IDS } from "@/lib/domain/types";

export const stageIdSchema = z.enum(STAGE_IDS);
export const policyModeSchema = z.enum(POLICY_MODES);
export const approvalKindSchema = z.enum(APPROVAL_KINDS);
export const findingSeveritySchema = z.enum(FINDING_SEVERITIES);
export const findingStatusSchema = z.enum(FINDING_STATUSES);

export const classificationSchema = z.object({
  workflow: z.literal("software-development"),
  taskType: z.enum(["bug_fix", "feature", "refactor", "chore"]),
  domains: z.array(z.string().min(1)).min(1),
  complexity: z.enum(["low", "medium", "high"]),
  risk: z.enum(["low", "medium", "high"]),
  specializations: z.array(z.string().min(1)),
  suggestedTests: z.array(z.string().min(1)),
  requiresSecurityReview: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export const createCardInputSchema = z.object({
  title: z.string().min(3).max(180),
  description: z.string().min(3).max(5000),
  repositoryId: z.string().uuid().nullable(),
});

export const updateCardInputSchema = z.object({
  title: z.string().min(3).max(180).optional(),
  description: z.string().min(3).max(5000).optional(),
  repositoryId: z.string().uuid().nullable().optional(),
  demoResolveFindingsOnAttempt: z.number().int().min(1).max(20).optional(),
});

export const transitionInputSchema = z.object({
  targetStageId: stageIdSchema,
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const approvalInputSchema = z.object({
  kind: approvalKindSchema,
  approved: z.boolean(),
  justification: z.string().min(3).max(1000),
});

export const updatePolicyInputSchema = z.object({
  mode: policyModeSchema,
});

export const dismissFindingInputSchema = z.object({
  findingId: z.string().uuid(),
  justification: z.string().min(5).max(1000),
});
