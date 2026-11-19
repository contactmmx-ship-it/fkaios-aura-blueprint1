// ONE BRAIN step 1 — the goal hierarchy is read straight from its own rows.
//
// Why (live evidence, 19 Nov 2026): getGoals() used founderMemory.permanent.get(),
// which returns only the newest 20 Founder Brain rows of ALL kinds. Insights,
// imagination and decisions written every tick pushed the two goal rows out of
// that window, so getGoals() came back empty, founder-brain-tick re-seeded the
// goals, and fleet_memory collected 1,078 goal rows for the same two goals —
// while evaluateAgainstGoals() mostly reasoned with NO goals at all.
//
// Pure helpers (no imports) so they can be unit-tested offline.

export interface GoalRow { structured_content: Record<string, unknown> | null; created_at: string }
export interface GoalLike { level?: string; description?: string; deadline?: string; [k: string]: unknown }

export const goalKey = (g: GoalLike): string =>
  `${String(g.level ?? "").trim().toLowerCase()}|${String(g.description ?? "").trim().toLowerCase()}`;

/** Newest row per (level, description); rows must be ordered newest first. */
export function latestGoals(rows: GoalRow[]): GoalLike[] {
  const seen = new Set<string>();
  const out: GoalLike[] = [];
  for (const r of rows) {
    const g = { kind: "goal", ...(r.structured_content ?? {}) } as GoalLike;
    const k = goalKey(g);
    if (k === "|" || seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  return out;
}

/** Goals from `wanted` that are not already present — the only ones a seed may write. */
export function missingGoals(existing: GoalLike[], wanted: GoalLike[]): GoalLike[] {
  const have = new Set(existing.map(goalKey));
  return wanted.filter((g) => !have.has(goalKey(g)));
}
