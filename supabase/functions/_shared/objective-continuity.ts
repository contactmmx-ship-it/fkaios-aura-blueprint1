/**
 * Bridge from FKAIOS's persisted canonical objective state to portable AI handoff.
 * The state row remains the source of truth; this adapter does not create a
 * competing task database or claim that a provider was dispatched.
 */
import { packetFromObjectiveSnapshot, validateContinuityPacket, type ContinuityPacket } from "./ai-continuity.ts";
import { syncObjectiveState, type Phase } from "./objective-state.ts";

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
  }, { ...options, nextAction: options.nextAction ?? (typeof row.next_action === "string" ? row.next_action : undefined) });
}


/** Persist a handoff snapshot for a later session/provider to retrieve. */
export async function saveObjectiveContinuityPacket(
  db: Db,
  packet: ContinuityPacket,
  sourceStateVersion?: number,
): Promise<void> {
  const checked = validateContinuityPacket(packet);
  if (!checked.valid) throw new Error(`Refusing to persist invalid continuity packet: ${checked.errors.join(" ")}`);
  if (sourceStateVersion !== undefined && (!Number.isInteger(sourceStateVersion) || sourceStateVersion < 0)) {
    throw new Error("sourceStateVersion must be a non-negative integer.");
  }
  const { error } = await db.from("fkaios_ai_continuity_packets").upsert({
    objective_id: packet.taskId,
    packet,
    packet_version: packet.version,
    source_state_version: sourceStateVersion ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "objective_id" });
  if (error) throw new Error(`Unable to persist continuity packet: ${error.message ?? String(error)}`);
}

/** Retrieve the latest saved packet after an interruption or tool switch. */
export async function readSavedObjectiveContinuityPacket(
  db: Db,
  objectiveId: string,
): Promise<{ packet: ContinuityPacket; sourceStateVersion: number | null; updatedAt: string | null } | null> {
  const { data, error } = await db.from("fkaios_ai_continuity_packets")
    .select("packet,source_state_version,updated_at")
    .eq("objective_id", objectiveId)
    .maybeSingle();
  if (error) throw new Error(`Unable to read saved continuity packet: ${error.message ?? String(error)}`);
  if (!data) return null;
  const checked = validateContinuityPacket(data.packet);
  if (!checked.valid) throw new Error(`Saved continuity packet failed validation: ${checked.errors.join(" ")}`);
  return {
    packet: checked.packet,
    sourceStateVersion: Number.isInteger(data.source_state_version) ? data.source_state_version : null,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
  };
}


export type ObjectiveStateSyncInput = { id: string; status: string; raw_request?: string };
export type ObjectiveStateSyncOverride = { phase?: Phase; reason?: string; patch?: Record<string, unknown> };
export type ContinuityAwareSyncResult = { ok: boolean; phase?: Phase; error?: string; continuityError?: string };

/**
 * Sync canonical state, then persist a portable checkpoint from that same
 * state. Continuity persistence failures are surfaced separately so callers
 * can log/monitor them without pretending the handoff was saved.
 */
export async function syncObjectiveStateWithContinuity(
  db: Db,
  objective: ObjectiveStateSyncInput,
  override?: ObjectiveStateSyncOverride,
): Promise<ContinuityAwareSyncResult> {
  const stateResult = await syncObjectiveState(db, objective, override);
  if (!stateResult.ok) return stateResult;
  try {
    const packet = await loadObjectiveContinuityPacket(
      db,
      objective.id,
      objective.raw_request ?? objective.id,
      { nextAction: typeof override?.patch?.next_action === "string" ? override.patch.next_action : undefined },
    );
    if (!packet) return { ...stateResult, continuityError: "Canonical objective state was not found after sync." };
    const version = Number((await db.from("fkaios_objective_state").select("state_version").eq("objective_id", objective.id).maybeSingle()).data?.state_version);
    await saveObjectiveContinuityPacket(db, packet, Number.isInteger(version) && version >= 0 ? version : undefined);
    return stateResult;
  } catch (err) {
    const continuityError = err instanceof Error ? err.message : String(err);
    console.error("[fkaios-continuity] Failed to persist objective checkpoint", { objectiveId: objective.id, error: continuityError });
    return { ...stateResult, continuityError };
  }
}
