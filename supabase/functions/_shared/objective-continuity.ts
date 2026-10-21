/**
 * Bridge from FKAIOS's persisted canonical objective state to portable AI handoff.
 * The state row remains the source of truth; this adapter does not create a
 * competing task database or claim that a provider was dispatched.
 */
import { packetFromObjectiveSnapshot, type ContinuityPacket } from "./ai-continuity.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface ObjectiveContinuityOptions {
  acceptanceCriteria?: string[];
  relevantContext?: string[];
  constraints?: string[];
  nextAction?: string;
  suggestedExecutor?: string;
}

/** Load the canonical persisted objective and export a provider-neutral resume packet. */
export async function loadObjectiveContinuityPacket(
  db: Db,
  objectiveId: string,
  objectiveFallback: string,
  options: ObjectiveContinuityOptions = {},
): Promise<ContinuityPacket | null> {
  const { data, error } = await db
    .from("fkaios_objective_state")
    .select("*")
    .eq("objective_id", objectiveId)
    .maybeSingle();

  if (error) throw new Error(`Unable to read canonical objective state: ${error.message ?? String(error)}`);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const phase = typeof row.phase === "string" ? row.phase : "planning";
  const stateVersion = Number(row.state_version);
  if (!Number.isInteger(stateVersion) || stateVersion < 0) {
    throw new Error("Canonical objective state has an invalid state_version.");
  }

  return packetFromObjectiveSnapshot({
    objectiveId,
    objective: typeof row.objective === "string" && row.objective.trim()
      ? row.objective
      : objectiveFallback,
    phase,
    stateVersion,
    patch: row,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
  }, options);
}
