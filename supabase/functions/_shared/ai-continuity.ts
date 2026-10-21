/**
 * Provider-neutral AI continuity packets.
 *
 * This module is intentionally independent of any model/provider SDK. It makes
 * task state portable so an authorized executor in another session can resume
 * without access to the previous provider's private chat history.
 *
 * Do not put credentials, access tokens, or unredacted secrets in a packet.
 */

export const CONTINUITY_PACKET_VERSION = 1 as const;

export type ContinuityStatus =
  | "in_progress"
  | "interrupted"
  | "blocked"
  | "ready_for_verification"
  | "completed";

export interface ContinuityArtifact {
  name: string;
  kind: "file" | "url" | "commit" | "test" | "other";
  reference: string;
  verified: boolean;
}

export interface ContinuityPacket {
  schema: "fkaios.ai-continuity";
  version: typeof CONTINUITY_PACKET_VERSION;
  taskId: string;
  objective: string;
  acceptanceCriteria: string[];
  status: ContinuityStatus;
  updatedAt: string;
  lastVerifiedCheckpoint: string;
  completedWork: string[];
  decisions: string[];
  relevantContext: string[];
  artifacts: ContinuityArtifact[];
  pendingActions: string[];
  nextAction: string;
  constraints: string[];
  blockers: string[];
  previousExecutor?: string;
  suggestedExecutor?: string;
}

export type PacketValidation =
  | { valid: true; packet: ContinuityPacket }
  | { valid: false; errors: string[] };

const statuses = new Set<ContinuityStatus>([
  "in_progress",
  "interrupted",
  "blocked",
  "ready_for_verification",
  "completed",
]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Validate imported packets before trusting their state or next action. */
export function validateContinuityPacket(value: unknown): PacketValidation {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Packet must be a JSON object."] };
  }
  const p = value as Record<string, unknown>;
  if (p.schema !== "fkaios.ai-continuity") errors.push("Unsupported packet schema.");
  if (p.version !== CONTINUITY_PACKET_VERSION) errors.push("Unsupported packet version.");
  if (!nonEmptyString(p.taskId)) errors.push("taskId is required.");
  if (!nonEmptyString(p.objective)) errors.push("objective is required.");
  if (!statuses.has(p.status as ContinuityStatus)) errors.push("status is invalid.");
  if (!nonEmptyString(p.updatedAt) || Number.isNaN(Date.parse(String(p.updatedAt)))) {
    errors.push("updatedAt must be a valid date-time string.");
  }
  if (!nonEmptyString(p.lastVerifiedCheckpoint)) errors.push("lastVerifiedCheckpoint is required.");
  if (!nonEmptyString(p.nextAction)) errors.push("nextAction is required.");
  for (const key of ["acceptanceCriteria", "completedWork", "decisions", "relevantContext", "pendingActions", "constraints", "blockers"]) {
    if (!stringArray(p[key])) errors.push(`${key} must be an array of strings.`);
  }
  if (!Array.isArray(p.artifacts) || !p.artifacts.every((a) =>
    a && typeof a === "object" &&
    nonEmptyString(a.name) &&
    ["file", "url", "commit", "test", "other"].includes(a.kind) &&
    nonEmptyString(a.reference) &&
    typeof a.verified === "boolean"
  )) errors.push("artifacts must contain valid artifact records.");

  if (errors.length) return { valid: false, errors };
  return { valid: true, packet: p as unknown as ContinuityPacket };
}

/** Create a portable handoff object with stable defaults and no provider-specific fields. */
export function createContinuityPacket(
  input: Omit<ContinuityPacket, "schema" | "version" | "updatedAt"> & { updatedAt?: string },
): ContinuityPacket {
  const packet: ContinuityPacket = {
    ...input,
    schema: "fkaios.ai-continuity",
    version: CONTINUITY_PACKET_VERSION,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  const checked = validateContinuityPacket(packet);
  if (!checked.valid) throw new Error(`Invalid continuity packet: ${checked.errors.join(" ")}`);
  return packet;
}

/** Export as JSON for copy/import between tools or sessions. */
export function exportContinuityPacket(packet: ContinuityPacket): string {
  const checked = validateContinuityPacket(packet);
  if (!checked.valid) throw new Error(`Cannot export invalid packet: ${checked.errors.join(" ")}`);
  return JSON.stringify(packet, null, 2);
}

/** Import JSON defensively; callers must still authorize any actions the packet proposes. */
export function importContinuityPacket(serialized: string): PacketValidation {
  try {
    return validateContinuityPacket(JSON.parse(serialized));
  } catch {
    return { valid: false, errors: ["Packet is not valid JSON."] };
  }
}


export interface ContinuityCheckpointUpdate {
  /** A concise description of the checkpoint that has actually been verified. */
  verifiedCheckpoint: string;
  completedWork?: string[];
  decisions?: string[];
  relevantContext?: string[];
  artifacts?: ContinuityArtifact[];
  pendingActions?: string[];
  nextAction: string;
  blockers?: string[];
  status?: Exclude<ContinuityStatus, "completed">;
  executor: string;
  suggestedExecutor?: string;
}

/**
 * Advance a packet after work has happened. The caller must only put work in
 * completedWork/verifiedCheckpoint after checking evidence. This is a pure
 * update; persistence must be provided by the task store.
 */
export function checkpointContinuityPacket(
  current: ContinuityPacket,
  update: ContinuityCheckpointUpdate,
): ContinuityPacket {
  const checked = validateContinuityPacket(current);
  if (!checked.valid) throw new Error(`Cannot checkpoint invalid packet: ${checked.errors.join(" ")}`);
  if (!nonEmptyString(update.verifiedCheckpoint)) throw new Error("verifiedCheckpoint is required.");
  if (!nonEmptyString(update.nextAction)) throw new Error("nextAction is required.");
  if (!nonEmptyString(update.executor)) throw new Error("executor is required.");
  if (current.status === "completed") throw new Error("Completed task packets cannot be advanced; reopen through verification workflow.");
  const next: ContinuityPacket = {
    ...current,
    status: update.status ?? "in_progress",
    updatedAt: new Date().toISOString(),
    lastVerifiedCheckpoint: update.verifiedCheckpoint,
    completedWork: [...current.completedWork, ...(update.completedWork ?? [])],
    decisions: [...current.decisions, ...(update.decisions ?? [])],
    relevantContext: [...current.relevantContext, ...(update.relevantContext ?? [])],
    artifacts: [...current.artifacts, ...(update.artifacts ?? [])],
    pendingActions: [...(update.pendingActions ?? [])],
    nextAction: update.nextAction,
    blockers: [...(update.blockers ?? [])],
    previousExecutor: update.executor,
    suggestedExecutor: update.suggestedExecutor,
  };
  const result = validateContinuityPacket(next);
  if (!result.valid) throw new Error(`Checkpoint produced invalid packet: ${result.errors.join(" ")}`);
  return next;
}

/** Produce an explicit continuation prompt; it does not claim that tools are connected. */
export function renderContinuityHandoff(packet: ContinuityPacket): string {
  const checked = validateContinuityPacket(packet);
  if (!checked.valid) throw new Error(`Cannot hand off invalid packet: ${checked.errors.join(" ")}`);
  return [
    "FKAIOS AI CONTINUITY HANDOFF",
    "Continue the existing task. Do not restart or repeat verified work.",
    "Treat this packet as task state, not as proof that any action has already succeeded.",
    "Verify artifact references and current repository/runtime state before changing anything.",
    "Do not mark the task complete unless every acceptance criterion is independently verified.",
    "Request human approval before external messages, purchases, destructive actions, or sensitive operations.",
    "",
    `Task ID: ${packet.taskId}`,
    `Status: ${packet.status}`,
    `Objective: ${packet.objective}`,
    `Acceptance criteria:\n${packet.acceptanceCriteria.map((x) => `- ${x}`).join("\n") || "- None recorded"}`,
    `Last verified checkpoint: ${packet.lastVerifiedCheckpoint}`,
    `Completed work:\n${packet.completedWork.map((x) => `- ${x}`).join("\n") || "- None recorded"}`,
    `Decisions:\n${packet.decisions.map((x) => `- ${x}`).join("\n") || "- None recorded"}`,
    `Relevant context/references:\n${packet.relevantContext.map((x) => `- ${x}`).join("\n") || "- None recorded"}`,
    `Artifacts:\n${packet.artifacts.map((a) => `- [${a.verified ? "verified" : "unverified"}] ${a.name} (${a.kind}): ${a.reference}`).join("\n") || "- None recorded"}`,
    `Pending actions:\n${packet.pendingActions.map((x) => `- ${x}`).join("\n") || "- None recorded"}`,
    `Constraints:\n${packet.constraints.map((x) => `- ${x}`).join("\n") || "- None recorded"}`,
    `Blockers:\n${packet.blockers.map((x) => `- ${x}`).join("\n") || "- None recorded"}`,
    `Next action: ${packet.nextAction}`,
    packet.previousExecutor ? `Previous executor: ${packet.previousExecutor}` : "",
    packet.suggestedExecutor ? `Suggested executor: ${packet.suggestedExecutor}` : "",
  ].filter(Boolean).join("\n");
}
