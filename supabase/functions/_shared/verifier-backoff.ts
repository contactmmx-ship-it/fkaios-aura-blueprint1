// Back off when no independent verifier is available (4 Nov 2026).
//
// Why: on 3 Nov 2026 every free provider except the producer's own model was
// rate-limited. The independence rule correctly refused same-model checks, but
// the objective loop asked again on every one-minute tick (16:34–17:04 UTC:
// 14 "verification unavailable" rows), burning the little quota left.
// Rule: after n consecutive "unavailable" verdicts, wait min(60, 2^n) minutes
// (2, 4, 8, 16, 32, 60) before asking again. Any real verdict resets it.
// Pure, so it is unit-tested offline.

export const UNAVAILABLE_PREFIX = "Independent verification unavailable";
export const MAX_BACKOFF_MINUTES = 60;

export interface VerifierRow { created_at?: unknown; verification_notes?: unknown }

/** Milliseconds to wait before the next verifier call (0 = call now). Rows: newest first. */
export function verifierBackoffMs(rows: VerifierRow[], now: Date): { waitMs: number; unavailableStreak: number } {
  let streak = 0;
  for (const row of rows) {
    if (String(row.verification_notes ?? "").startsWith(UNAVAILABLE_PREFIX)) streak++;
    else break;
  }
  if (streak === 0) return { waitMs: 0, unavailableStreak: 0 };
  const last = Date.parse(String(rows[0]?.created_at ?? ""));
  if (!Number.isFinite(last)) return { waitMs: 0, unavailableStreak: streak };
  const delayMs = Math.min(MAX_BACKOFF_MINUTES, 2 ** streak) * 60_000;
  return { waitMs: Math.max(0, last + delayMs - now.getTime()), unavailableStreak: streak };
}
