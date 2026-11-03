// Resume instead of re-plan (3 Nov 2026).
//
// Why: GoMax objective 520f871e failed AFTER its last plan's work passed the
// independent verifier, only because its stored contract asked for evidence a
// written plan cannot produce (fixed for new objectives in PR #234). A founder
// re-run used to throw that finished work away and plan again; with the
// lifetime cap of 3 plans already used, the re-run would have failed at once.
//
// Rule: when the founder re-runs an objective whose LAST plan finished every
// task AND was passed by the independent verifier, FKAIOS re-checks that work
// (with the contract re-derived from the objective text) instead of planning
// again. If the re-check fails, the normal rectify / replan rules apply.
// Pure: only objective-contract.ts (itself pure) is imported, so it is unit-tested offline.

import { baselineObjectiveContract, completionContract } from "./objective-contract.ts";

const FINISHED = new Set(["done", "completed", "verified", "approved"]);

export interface ResumeInput {
  latestProjectId: string;
  latestProjectTasks: Array<{ status?: unknown }>;
  /** Most recent independent-verifier evidence row (requirement_key objective_verifier:v1) for the objective. */
  latestVerifier: { project_id?: unknown; status?: unknown } | null;
}

export function resumeDecision(input: ResumeInput): { resume: boolean; reason: string } {
  if (!input.latestProjectId) return { resume: false, reason: "no earlier plan to resume" };
  const tasks = input.latestProjectTasks;
  if (tasks.length === 0) return { resume: false, reason: "the last plan has no tasks" };
  const unfinished = tasks.filter((t) => !FINISHED.has(String(t.status ?? "").toLowerCase())).length;
  if (unfinished > 0) return { resume: false, reason: `${unfinished} of ${tasks.length} task(s) in the last plan did not finish` };
  const v = input.latestVerifier;
  if (!v || String(v.project_id ?? "") !== input.latestProjectId || String(v.status ?? "") !== "passed") {
    return { resume: false, reason: "the independent verifier did not pass the last plan's work" };
  }
  return { resume: true, reason: `all ${tasks.length} task(s) of the last plan finished and the independent verifier passed it` };
}

export interface StoredContract {
  objective_type?: unknown;
  evidence_requirements?: unknown;
  acceptance_criteria?: unknown;
  continuity?: unknown;
  version?: unknown;
  status?: unknown;
}

/**
 * The update that brings a stored contract in line with the objective text under the CURRENT rules, keeping the
 * replaced version inside continuity.previous_contracts (nothing is deleted). null when nothing changes.
 */
export function refreshedContract(stored: StoredContract | null, rawObjective: string, riskLevel: string, at: string): Record<string, unknown> | null {
  if (!stored) return null;
  const current = completionContract(rawObjective);
  const storedReq = Array.isArray(stored.evidence_requirements) ? stored.evidence_requirements.map(String) : [];
  const sameReq = storedReq.length === current.requiredEvidence.length && storedReq.every((r, i) => r === current.requiredEvidence[i]);
  if (sameReq && String(stored.objective_type ?? "") === current.objectiveType) return null;
  const base = baselineObjectiveContract(rawObjective, riskLevel);
  const continuity = stored.continuity && typeof stored.continuity === "object" && !Array.isArray(stored.continuity) ? stored.continuity as Record<string, unknown> : {};
  const history = Array.isArray(continuity.previous_contracts) ? continuity.previous_contracts : [];
  const version = Number(stored.version ?? 1) || 1;
  return {
    objective_type: base.objective_type,
    acceptance_criteria: base.acceptance_criteria,
    evidence_requirements: base.evidence_requirements,
    status: "executing",
    version: version + 1,
    updated_at: at,
    continuity: {
      ...continuity,
      previous_contracts: [...history, {
        version, objective_type: stored.objective_type ?? null, evidence_requirements: stored.evidence_requirements ?? null,
        acceptance_criteria: stored.acceptance_criteria ?? null, status: stored.status ?? null,
        replaced_at: at, reason: "founder re-run: contract re-derived from the objective text under the current rules",
      }],
    },
  };
}
