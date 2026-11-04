// 4 Nov 2026 (run 6): the writer prompt was 48k → 151k tokens because the job payload was sent whole —
// including the FULL outputs of up to 12 earlier tasks — and then the same evidence again, capped, as
// [PRIOR COMPLETED TASK EVIDENCE]. The earlier outputs now travel once, through the capped evidence blocks;
// the payload copy keeps only each task's id and title, and very long strings are cut.

export const PAYLOAD_STRING_LIMIT = 14000;
export const PRIOR_EVIDENCE_CHARS = 30000;

function cut(value: unknown, limit: number): unknown {
  if (typeof value === "string") return value.length > limit ? value.slice(0, limit) + ` …[cut: ${value.length - limit} more chars]` : value;
  if (Array.isArray(value)) return value.map((v) => cut(v, limit));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cut(v, limit);
    return out;
  }
  return value;
}

/** The job payload as it goes into a prompt: earlier task outputs replaced by an index, long strings cut. */
export function payloadForPrompt(payload: unknown, limit = PAYLOAD_STRING_LIMIT): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return cut(payload, limit);
  const p = { ...(payload as Record<string, unknown>) };
  if (Array.isArray(p.prior_completed_tasks)) {
    p.prior_completed_tasks = (p.prior_completed_tasks as Array<Record<string, unknown>>).map((t) => ({
      id: t?.id ?? null,
      title: t?.title ?? null,
      output: "(see PRIOR COMPLETED TASK EVIDENCE below)",
    }));
  }
  return cut(p, limit);
}

/** Rough token estimate (4 characters ≈ 1 token) used for logging and tests. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
