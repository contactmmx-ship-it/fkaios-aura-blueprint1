import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { reason, getGoals, founderMemory, worldLearn, FOUNDER_BRAIN_DEPARTMENT } from "./founder-brain.ts";
import { executeCapability } from "./company-os.ts";
import { getReflectionHistory } from "./executive-planner.ts";

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

export interface KnowledgeGap { question: string; reason: string; investigatesContradiction?: boolean }

export async function identifyKnowledgeGaps(userId: string, count = 2, correlationId?: string): Promise<KnowledgeGap[]> {
  const [goals, recentActivity, reflectionHistory] = await Promise.all([
    getGoals(userId),
    founderMemory.episodic.query({}),
    getReflectionHistory(userId),
  ]);

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
  }
  return [];
}

export interface CuriosityResult {
  question: string;
  action: "researched" | "skipped_duplicate" | "skipped_unverified" | "error";
  detail: string;
}

export async function curiosityTick(userId: string, correlationId?: string): Promise<CuriosityResult[]> {
  const gaps = await identifyKnowledgeGaps(userId, 2, correlationId);
  if (gaps.length === 0) return [];

  let contradictionText: string | null = null;

  const results: CuriosityResult[] = [];

  for (const gap of gaps) {
    let existing: unknown[] = [];
    try {
      existing = await founderMemory.knowledge.search(gap.question);
    } catch { }

    if (existing.length >= 3) {
      results.push({ question: gap.question, action: "skipped_duplicate", detail: `${existing.length} existing knowledge entries already cover this` });
      continue;
    }

    const dispatch = await executeCapability("research.run", { query: gap.question, requested_by: "curiosity-engine" }, correlationId);

    if (dispatch.status === "unverified_capability" || dispatch.status === "unknown_capability") {
      results.push({ question: gap.question, action: "skipped_unverified", detail: dispatch.error ?? "capability not dispatchable" });
      continue;
    }

    if (dispatch.status === "error") {
      results.push({ question: gap.question, action: "error", detail: dispatch.error ?? "research dispatch failed" });
      continue;
    }

    try {
      const learned = await worldLearn(userId, { source: "research-engine", topic: gap.question, content: JSON.stringify(dispatch.data).slice(0, 4000) }, correlationId);
      results.push({ question: gap.question, action: "researched", detail: learned.stored ? `stored: ${learned.reason}` : learned.reason });

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
          } catch { }
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
  } catch { }

  return results;
}

export async function getCuriosityHistory(limit = 10): Promise<Array<{ topic: string; source: string; created_at: string }>> {
  const client = getClient();
  const { data } = await client
    .from("fleet_memory")
    .select("memory_type, structured_content, created_at")
    .eq("source_department", FOUNDER_BRAIN_DEPARTMENT)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? [])
    .map((r: { memory_type: string; structured_content: Record<string, unknown> | null; created_at: string }) => ({ content: { kind: r.memory_type, ...(r.structured_content ?? {}) }, updated_at: r.created_at }))
    .filter((r) => r.content?.kind === "world_learning")
    .slice(0, limit)
    .map((r) => ({ topic: (r.content as { topic?: string }).topic ?? "unknown", source: (r.content as { source?: string }).source ?? "unknown", created_at: r.updated_at }));
  return rows;
}

export interface BeliefEntry { previousBelief: string; newEvidence: string; currentBelief: string; resolved: boolean; created_at: string }
export async function getBeliefHistory(limit = 5): Promise<BeliefEntry[]> {
  const client = getClient();
  const { data } = await client
    .from("fleet_memory")
    .select("memory_type, structured_content, created_at")
    .eq("source_department", FOUNDER_BRAIN_DEPARTMENT)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? [])
    .map((r: { memory_type: string; structured_content: Record<string, unknown> | null; created_at: string }) => ({ content: { kind: r.memory_type, ...(r.structured_content ?? {}) }, updated_at: r.created_at }))
    .filter((r) => r.content?.kind === "belief")
    .slice(0, limit)
    .map((r) => {
      const c = r.content as { previousBelief?: string; newEvidence?: string; currentBelief?: string; resolved?: boolean };
      return { previousBelief: c.previousBelief ?? "", newEvidence: c.newEvidence ?? "", currentBelief: c.currentBelief ?? "", resolved: !!c.resolved, created_at: r.updated_at };
    });
  return rows;
}
