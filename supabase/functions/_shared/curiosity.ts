// ============================================================================
// CURIOSITY ENGINE — SPRINT 12 (M1-S12)
// ============================================================================
// Founder Brain → Executive Planner → Departments → Work Engine →
// AI Employees → Execution Runtime → Company OS → Business Systems →
// Learning → Founder Brain
//
// This module answers the "Curiosity" section of the Human + AI Combined
// Intelligence document: "It should ask: what don't I know? what should I
// learn next? Curiosity should generate research opportunities
// automatically." It is the missing input pipe for worldLearn() (built
// Sprint 3, never fed) — nothing else.
//
// TECHNOLOGY INTEGRATION AUDIT (Level 1 first, per the Constitution):
//   - Research execution -> research-engine, already exists, already real:
//     action='run' takes {query}, calls a live Apify actor
//     ('apify~google-search-scraper' by default), writes to a real
//     `research_runs` table (query/actor_used/requested_by/status). This
//     is NOT a stub — it spends real Apify credits against a token stored
//     via apify-settings. DECISION: REUSE, via the ALREADY-VERIFIED
//     Company OS capability 'research.run' (Sprint 11 read this exact
//     action in source and marked it verified:true) — this module does
//     not call research-engine directly, it goes through executeCapability()
//     so every research dispatch gets Company OS's retry+logging for free.
//   - Deduplication -> founderMemory.knowledge.search() + worldLearn()'s
//     existing new/duplicate LLM check (Sprint 3). NOT rebuilt — a gap
//     question is checked against existing knowledge BEFORE spending an
//     Apify credit on it, and worldLearn() re-checks again before storing.
//   - Question generation -> reason() (founder-brain.ts). No new LLM path.
// DECISION: BUILD is limited to the one truly missing piece — deciding
// WHAT to research, and not asking twice. Everything else is reuse.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { reason, getGoals, founderMemory, worldLearn } from "./founder-brain.ts";
import { executeCapability } from "./company-os.ts";
import { getReflectionHistory } from "./executive-planner.ts";

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

export interface KnowledgeGap { question: string; reason: string; investigatesContradiction?: boolean }

// ── "What don't I know?" — grounded in the real goal hierarchy and recent
//    activity, not free-floating curiosity. Honest empty result if the
//    model doesn't return parseable JSON (same discipline as every other
//    generator in this codebase since Sprint 3). ──
export async function identifyKnowledgeGaps(userId: string, count = 2, correlationId?: string): Promise<KnowledgeGap[]> {
  const [goals, recentActivity, reflectionHistory] = await Promise.all([
    getGoals(userId),
    founderMemory.episodic.query({}),
    getReflectionHistory(userId),
  ]);

  // INTEGRATION (2026-07-18): second consumer of the Importance signal
  // (first was Executive Attention, f334b4a). Reuses the SAME real data —
  // the latest Reflection's assumptionsWrong field — rather than inventing
  // a second signal. A real, stated contradiction is now an explicit input
  // to what Curiosity considers worth investigating, not a separate
  // mechanism. Per the honesty rule: this is Integration, not Emergence —
  // two organs now consume Importance independently, but "emergence"
  // requires observing them produce a NEW combined behavior neither
  // organ has alone, which has not been observed yet.
  const latestReflection = reflectionHistory.length > 0 ? reflectionHistory[reflectionHistory.length - 1] : null;
  const contradiction = latestReflection?.assumptionsWrong?.trim() ? latestReflection.assumptionsWrong : null;

  const result = await reason(
    `You are the Founder Brain being curious. Given the goal hierarchy, recent company activity, and (if present) a contradiction the Brain recently found in its own thinking, identify exactly ${count} SPECIFIC knowledge gaps worth researching — things the company doesn't know but needs to, to move toward its goals. If a contradiction is provided, one of your ${count} gaps MUST be about investigating that specific contradiction — this takes priority over generic gaps, and that gap's JSON object must include "investigatesContradiction": true. Not generic ("learn about marketing") — specific and actionable ("what franchise investment thresholds are competitors offering in Tier-2 cities right now"). Return ONLY a JSON array of {question, reason, investigatesContradiction?}.`,
    `GOALS:\n${JSON.stringify(goals)}\n\nRECENT ACTIVITY (last 50 events):\n${JSON.stringify(recentActivity.slice(0, 20))}${contradiction ? `\n\nRECENT CONTRADICTION THE BRAIN FOUND IN ITS OWN THINKING (investigate this):\n${contradiction}` : ""}`,
    600,
    correlationId,
  );

  try {
    const parsed = JSON.parse(result.text);
    if (Array.isArray(parsed)) return parsed.filter((g) => g?.question);
  } catch {
    // Honest empty result — no fabricated gaps if parsing fails.
  }
  return [];
}

export interface CuriosityResult {
  question: string;
  action: "researched" | "skipped_duplicate" | "skipped_unverified" | "error";
  detail: string;
}

// ── One curiosity cycle: identify gaps, skip ones already known, dispatch
//    the rest through the ALREADY-VERIFIED Company OS research capability,
//    feed real results into worldLearn(). ──
export async function curiosityTick(userId: string, correlationId?: string): Promise<CuriosityResult[]> {
  const gaps = await identifyKnowledgeGaps(userId, 2, correlationId);
  if (gaps.length === 0) return [];

  // Only fetched if actually needed below (a gap is tagged as investigating
  // a contradiction) — avoids an unnecessary read on the common case where
  // no contradiction exists.
  let contradictionText: string | null = null;

  const results: CuriosityResult[] = [];

  for (const gap of gaps) {
    // Dedup BEFORE spending a research credit — check existing knowledge first.
    let existing: unknown[] = [];
    try {
      existing = await founderMemory.knowledge.search(gap.question);
    } catch { /* if the check fails, fall through and let worldLearn's own dedup catch it */ }

    if (existing.length >= 3) {
      results.push({ question: gap.question, action: "skipped_duplicate", detail: `${existing.length} existing knowledge entries already cover this` });
      continue;
    }

    const dispatch = await executeCapability("research.run", { query: gap.question, requested_by: "curiosity-engine" }, correlationId);

    if (dispatch.status === "unverified_capability" || dispatch.status === "unknown_capability") {
      // Should not happen — research.run was verified in Sprint 11 — but
      // if the registry ever changes, fail honestly rather than silently.
      results.push({ question: gap.question, action: "skipped_unverified", detail: dispatch.error ?? "capability not dispatchable" });
      continue;
    }

    if (dispatch.status === "error") {
      results.push({ question: gap.question, action: "error", detail: dispatch.error ?? "research dispatch failed" });
      continue;
    }

    // Real Apify results (or whatever research-engine returned) go through
    // worldLearn()'s own new/duplicate check and synthesis — not stored
    // twice, not stored verbatim.
    try {
      const learned = await worldLearn(userId, { source: "research-engine", topic: gap.question, content: JSON.stringify(dispatch.data).slice(0, 4000) }, correlationId);
      results.push({ question: gap.question, action: "researched", detail: learned.stored ? `stored: ${learned.reason}` : learned.reason });

      // BELIEF FORMATION (2026-07-18): closes the loop this cycle's
      // diagnosis identified — investigating a contradiction previously
      // evaporated into generic learning with no connection back to what
      // triggered it. If THIS gap was explicitly tagged as investigating a
      // real contradiction, and the investigation actually produced new
      // learning, form a real Belief revision: what the Brain used to
      // think, what it found, what it thinks now. Grounded entirely in
      // real text (the actual contradiction, the actual research result)
      // — reason() is used to compose the statement, not to invent the
      // underlying facts.
      if (gap.investigatesContradiction && learned.stored) {
        if (contradictionText === null) {
          const history = await getReflectionHistory(userId);
          const latest = history.length > 0 ? history[history.length - 1] : null;
          contradictionText = latest?.assumptionsWrong?.trim() || null;
        }
        if (contradictionText) {
          try {
            const beliefResult = await reason(
              "You are the Founder Brain forming a belief revision. You previously found a contradiction in your own thinking and just investigated it. State explicitly: what you used to think, what you learned, and what you think now. Be honest if the investigation didn't fully resolve the contradiction — say so rather than forcing a clean resolution. Return ONLY JSON: {previousBelief, newEvidence, currentBelief, resolved: boolean}.",
              `PREVIOUS CONTRADICTION:\n${contradictionText}\n\nWHAT THE INVESTIGATION FOUND:\n${JSON.stringify(dispatch.data).slice(0, 2000)}`,
              500,
              correlationId,
            );
            const parsed = JSON.parse(beliefResult.text);
            if (parsed?.currentBelief) {
              await founderMemory.permanent.set(userId, { kind: "belief", previousBelief: parsed.previousBelief ?? contradictionText, newEvidence: parsed.newEvidence ?? "", currentBelief: parsed.currentBelief, resolved: !!parsed.resolved, created_at: new Date().toISOString() });
            }
          } catch { /* honest silence — no fabricated belief if this fails or doesn't parse */ }
        }
      }
    } catch (err) {
      results.push({ question: gap.question, action: "error", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  try {
    await founderMemory.episodic.append({
      function_name: "curiosity-engine", action: "curiosity_tick", status: "success",
      output_summary: results.map((r) => `${r.action}: ${r.question}`).join("; ").slice(0, 400),
    });
  } catch { /* non-blocking */ }

  return results;
}

// ── Real aggregation for the Founder Workspace — what has curiosity
//    actually looked into, not a fabricated count. ──
export async function getCuriosityHistory(limit = 10): Promise<Array<{ topic: string; source: string; created_at: string }>> {
  const client = getClient();
  const { data } = await client.from("founder_memory").select("content, updated_at").order("updated_at", { ascending: false }).limit(50);
  const rows = (data ?? [])
    .map((r: { content?: { kind?: string; topic?: string; source?: string }; updated_at: string }) => ({ content: r.content, updated_at: r.updated_at }))
    .filter((r) => r.content?.kind === "world_learning")
    .slice(0, limit)
    .map((r) => ({ topic: r.content!.topic ?? "unknown", source: r.content!.source ?? "unknown", created_at: r.updated_at }));
  return rows;
}
