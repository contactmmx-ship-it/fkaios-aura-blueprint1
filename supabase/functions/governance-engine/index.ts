// governance-engine v4 — same reviewer logic as v3, but the verdict is now
// forced through Anthropic tool-use (emit_verdict) instead of free-text JSON.
// Root cause of the v3 502 (verified via pg_net: empty raw text): the longer
// constitution+principles prompt made claude-sonnet-5 spend the entire
// max_tokens budget on thinking blocks, emitting zero text. Tool-use output
// is structurally guaranteed and cannot be truncated into invalid JSON.
// Also raised max_tokens to 4000. Review criteria + profile scoring unchanged.
//
// [GIT PARITY 2026-07-12] This function existed ONLY in production and was
// never committed. Pulled into the repo as-is (Blueprint P2.4 — deployment
// discipline). SECURITY: SHARED_SECRET is hardcoded below; it must be moved
// to Deno.env.get('HEARTBEAT_SECRET') and rotated (Blueprint P1.5).

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SHARED_SECRET = "kjhgfdsa"; // TODO(P1.5): move to env + rotate
const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const VERDICT_TOOL = {
  name: "emit_verdict",
  description: "Emit the constitutional review verdict. This is the ONLY way to respond.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["approved", "rejected", "needs_redesign"] },
      per_law: { type: "array", items: { type: "object", properties: { law_number: { type: "number" }, pass: { type: "boolean" }, reasoning: { type: "string" } }, required: ["law_number", "pass"] } },
      overall_reasoning: { type: "string" },
    },
    required: ["verdict", "overall_reasoning"],
  },
};

async function updateIntelligenceProfile(agent: string, approved: boolean, context: string) {
  const { data: prof } = await supabase.from("agent_intelligence_profiles").select("*").eq("agent_name", agent).maybeSingle();
  const oldScore = Number(prof?.governance_score ?? 0.5);
  const newScore = Math.round((0.9 * oldScore + 0.1 * (approved ? 1 : 0)) * 1000) / 1000;
  const total = Number(prof?.total_decisions ?? 0) + 1;
  const ok = Number(prof?.successful_decisions ?? 0) + (approved ? 1 : 0);
  const bad = Number(prof?.failed_decisions ?? 0) + (approved ? 0 : 1);
  let trust = String(prof?.trust_level ?? "probation");
  if (trust === "probation" && total >= 10 && newScore >= 0.8) trust = "trusted";
  else if (trust === "trusted" && total >= 30 && newScore >= 0.9) trust = "veteran";
  const failure_history = approved ? (prof?.failure_history ?? []) : [...(prof?.failure_history ?? []), { at: new Date().toISOString(), context: context.slice(0, 200) }].slice(-20);
  await supabase.from("agent_intelligence_profiles").upsert({
    agent_name: agent, governance_score: newScore, total_decisions: total,
    successful_decisions: ok, failed_decisions: bad,
    success_rate: total > 0 ? Math.round((ok / total) * 1000) / 10 : null,
    trust_level: trust, failure_history, updated_at: new Date().toISOString(),
  }, { onConflict: "agent_name" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== SHARED_SECRET) return j({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return j({ error: "Invalid JSON" }, 400); }

  const isUniversal = !!body.decision_id;
  const id = String(body.decision_id ?? body.proposal_id ?? "");
  if (!id) return j({ error: "Missing decision_id or proposal_id" }, 400);
  const table = isUniversal ? "governed_decisions" : "engineering_change_proposals";

  const { data: p, error: pErr } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (pErr || !p) return j({ error: `Not found in ${table}: ${pErr?.message ?? id}` }, 404);
  if (p.status !== "review") return j({ error: `Status is '${p.status}', not 'review'.` }, 409);

  const { data: laws } = await supabase.from("engineering_constitution").select("law_number,name,description").eq("active", true).order("law_number");
  const { data: principles } = await supabase.from("founder_principles").select("principle").eq("active", true).order("weight", { ascending: false });

  const system = `You are the independent Supreme Constitutional Authority of FKAIOS. You did NOT write this proposal and have no stake in it. Evaluate it strictly against every constitutional law, with special scrutiny on Law 1 (preservation), Business Justification quality, and Vision Alignment with the Artificial Enterprise mission. Be tough — reject or demand redesign when evidence is thin, justification vague, vision alignment decorative, rollback hand-wavy, or outcomes unmeasurable. Never approve to be agreeable. Emit your verdict ONLY through the emit_verdict tool.`;
  const user = `CONSTITUTION:\n${(laws ?? []).map((l: any) => `${l.law_number}. ${l.name}: ${l.description}`).join("\n")}\n\nFOUNDER PRINCIPLES:\n${(principles ?? []).map((x: any) => `- ${x.principle}`).join("\n").slice(0, 4000)}\n\nDECISION UNDER REVIEW (${isUniversal ? `domain: ${p.domain}` : "engineering"}):\nProposing agent: ${p.proposing_agent}\nTitle: ${p.title ?? p.target_module}\nChange type: ${p.change_type}\nWhy required: ${p.why_required}\nUnderstanding: ${p.understanding_report}\nPreservation analysis: ${JSON.stringify(p.preservation_analysis)}\nSelf-validation: ${JSON.stringify(p.constitution_validation)}\nBusiness justification: ${p.business_justification ?? "(legacy)"}\nVision alignment: ${p.vision_alignment ?? "(legacy)"}\nExpected outcome: ${p.expected_outcome ?? "n/a"}\nRisks: ${p.risks ?? "none"}\nRollback: ${p.rollback_strategy}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 4000, system, tools: [VERDICT_TOOL], tool_choice: { type: "tool", name: "emit_verdict" }, messages: [{ role: "user", content: user }] }),
  });
  if (!resp.ok) return j({ error: `Reviewer LLM failed: ${resp.status} ${await resp.text()}` }, 502);
  const data = await resp.json();
  const tb = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === "tool_use" && b?.name === "emit_verdict") : null;
  if (!tb?.input) return j({ error: "No verdict emitted", stop_reason: data?.stop_reason }, 502);
  const verdictObj: any = tb.input;

  const verdict = ["approved", "rejected", "needs_redesign"].includes(verdictObj.verdict) ? verdictObj.verdict : "needs_redesign";
  const newStatus = verdict === "approved" ? "approved" : "rejected";

  const { error: uErr } = await supabase.from(table).update({
    reviewer_agent: "governance-engine", review_verdict: verdict,
    review_reasoning: JSON.stringify({ per_law: verdictObj.per_law ?? [], overall: verdictObj.overall_reasoning ?? "" }).slice(0, 8000),
    status: newStatus,
  }).eq("id", id);
  if (uErr) return j({ error: `DB rejected verdict write: ${uErr.message}` }, 409);

  await updateIntelligenceProfile(String(p.proposing_agent), verdict === "approved", `${table}:${p.title ?? p.target_module}`);
  await supabase.from("audit_logs").insert({
    action: `governance:review:${verdict}`, resource_type: table, actor_type: "agent",
    decision_reasoning: `Independent constitutional review of "${p.title ?? p.target_module}" by ${p.proposing_agent}: ${verdict}. ${String(verdictObj.overall_reasoning ?? "").slice(0, 400)}`,
    requires_human_review: verdict !== "approved", metadata: { id, table },
  });

  return j({ success: true, id, table, verdict, status: newStatus, overall_reasoning: verdictObj.overall_reasoning ?? "", per_law: verdictObj.per_law ?? [] });
});
