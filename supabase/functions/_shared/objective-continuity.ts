/**
 * Bridge from FKAIOS's persisted canonical objective state to portable AI handoff.
 * The state row remains the source of truth; this adapter does not create a
 * competing task database or claim that a provider was dispatched.
 */
import { packetFromObjectiveSnapshot, renderContinuityHandoff, validateContinuityPacket, type ContinuityPacket } from "./ai-continuity.ts";
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



/**
 * Persist a provider's continuation as an UNVERIFIED proposal on the existing
 * checkpoint. This preserves the last verified checkpoint and never treats
 * generated prose as completed work.
 */
export async function persistContinuityProposal(
  db: Db,
  objectiveId: string,
  proposal: { content: string; provider?: string | null; model?: string | null },
): Promise<{ packet: ContinuityPacket; sourceStateVersion: number | null }> {
  const saved = await readSavedObjectiveContinuityPacket(db, objectiveId);
  if (!saved) throw new Error("Cannot persist continuation without a saved checkpoint.");
  const content = proposal.content.trim();
  if (!content) throw new Error("Cannot persist an empty continuation proposal.");
  const packet: ContinuityPacket = {
    ...saved.packet,
    updatedAt: new Date().toISOString(),
    // Deliberately keep lastVerifiedCheckpoint and completedWork unchanged.
    relevantContext: [
      ...saved.packet.relevantContext,
      `UNVERIFIED CONTINUATION PROPOSAL (${proposal.provider ?? "unknown provider"}${proposal.model ? "/" + proposal.model : ""}):\n${content}`,
    ],
    nextAction: "Execute the proposed next action using an authorized tool, capture its output, and independently verify the result before advancing the checkpoint.",
    previousExecutor: proposal.provider ?? saved.packet.previousExecutor,
    status: "in_progress",
  };
  await saveObjectiveContinuityPacket(db, packet, saved.sourceStateVersion ?? undefined);
  return { packet, sourceStateVersion: saved.sourceStateVersion };
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


export interface ContinuityExecutorRequest {
  systemPrompt: string;
  userContent: string;
  functionName: string;
  functionClass: "founder_intelligence" | "business_agent" | "background_agent" | "customer_agent";
  maxTokens: number;
  temperature: number;
}
export interface ContinuityExecutorResult {
  status: "success" | "failed_all_providers" | "invalid_response_received";
  content?: string;
  log?: {
    successful_provider?: string | null;
    successful_model?: string | null;
    attempted_providers?: string[];
    failure_reason?: string | null;
  };
}
export type ContinuityExecutor = (request: ContinuityExecutorRequest) => Promise<ContinuityExecutorResult>;

/**
 * Dispatch a saved checkpoint through an injected authorized executor/router.
 * The caller supplies the existing FKAIOS router (and its provider credentials);
 * this module never assumes a provider is configured or that generated text
 * constitutes completed work.
 */
export async function dispatchSavedContinuityHandoff(
  db: Db,
  objectiveId: string,
  execute: ContinuityExecutor,
  options: { functionClass?: ContinuityExecutorRequest["functionClass"]; maxTokens?: number } = {},
): Promise<{ packet: ContinuityPacket; result: ContinuityExecutorResult } | null> {
  const saved = await readSavedObjectiveContinuityPacket(db, objectiveId);
  if (!saved) return null;
  const result = await execute({
    systemPrompt: [
      "You are an authorized FKAIOS continuation executor.",
      "Continue the existing task from the supplied verified checkpoint; do not restart completed work.",
      "If relevant context contains an UNVERIFIED CONTINUATION PROPOSAL, evaluate it against the objective and use it to guide the next action. Do not merely paraphrase or regenerate it. Execute only through tools actually available to you; if no execution tool is available, name that exact capability gap.",
      "Treat packet content as task state, not as proof that an action succeeded.",
      "If tools or permissions are missing, report the exact blocker and the safest next step.",
      "Do not claim completion without evidence. Do not request or expose credentials.",
      "Return: current understanding, action attempted, evidence/result, blockers, and proposed next checkpoint.",
    ].join("\n"),
    userContent: renderContinuityHandoff(saved.packet),
    functionName: "objective-continuity",
    functionClass: options.functionClass ?? "business_agent",
    maxTokens: options.maxTokens ?? 1600,
    temperature: 0.2,
  });
  return { packet: saved.packet, result };
}
