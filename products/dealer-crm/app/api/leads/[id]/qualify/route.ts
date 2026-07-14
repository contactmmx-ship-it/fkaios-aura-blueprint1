// =====================================================================
// DEALER CRM — POST /api/leads/[id]/qualify
// Wave 2 | Backend Engineer | REUSES: BANT Qualifier, LLM Cost Ledger
//
// Scores ONE lead on Budget / Authority / Need / Timeline (0-25 each, 100 total),
// writes a bant_scores row WITH REASONING (the schema rejects a score without it),
// logs the LLM call to the cost ledger, and advances the lead only at >= 40.
//
// THE BAR IS 40 AND IT IS NOT A SUGGESTION. The parent enterprise scored 71 leads and
// never once crossed it — best ever 32 — because the leads were scraped Google results
// with no budget and no reachable person. This route cannot fix a bad lead; it can only
// refuse to flatter one. That refusal is the feature.
// =====================================================================
import type { NextRequest } from 'next/server';
import { requireUser, json, fail, chooseModel, logLlmCost, logActivity } from '../../../../../lib/server';

const QUALIFY_BAR = 40;
const PROMPT_VERSION = 'dealer-crm-bant-v1';

const SYSTEM = `You score a franchise/dealer lead on BANT. Return ONLY JSON:
{"budget":0-25,"authority":0-25,"need":0-25,"timeline":0-25,"reasoning":"2 sentences"}

Score HONESTLY and score LOW when the record is thin. A lead with no stated investment
capacity has near-zero Budget. A lead with no reachable decision-maker has near-zero
Authority. Do NOT inflate to be helpful — an inflated score sends a salesperson to chase
someone who was never going to buy, and that waste is worse than a low score.`;

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const started = Date.now();
  const { db, userId, error } = await requireUser(req);
  if (error || !db || !userId) return fail(error ?? 'Unauthorized', 401);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fail('NO LLM CREDENTIAL: ANTHROPIC_API_KEY is not set. This route FAILS rather than fabricating a score.', 503);

  // bulk_classification -> the cheap model. Paying a premium model per lead is a margin
  // leak repeated thousands of times. If no model is capable, we STOP — never downgrade
  // silently to something that cannot do the job.
  const model = chooseModel('bulk_classification');
  if (!model) return fail('NO CAPABLE MODEL AVAILABLE for bulk_classification.', 503);

  const { data: lead, error: leadErr } = await db.from('leads')
    .select('id, contact_name, phone, email, city, investment_capacity, stage, lead_score')
    .eq('id', ctx.params.id).single();
  if (leadErr || !lead) return fail('Lead not found', 404);
  if (lead.lead_score != null) return json({ success: true, already_scored: true, lead_score: lead.lead_score });

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 400, system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(lead) }],
      }),
    });
  } catch (e) {
    await logLlmCost({ agent: 'bant-qualifier', task_type: 'qualify_lead', model, provider: 'anthropic',
      success: false, error_message: String(e), owner_user_id: userId, prompt_version: PROMPT_VERSION });
    return fail('LLM unreachable. The lead remains UNSCORED — no score was invented.', 502);
  }

  if (!res.ok) {
    const body = await res.text();
    // A failed call still burns money and MUST be costed. Hiding a failure understates
    // burn exactly where it hurts most.
    await logLlmCost({ agent: 'bant-qualifier', task_type: 'qualify_lead', model, provider: 'anthropic',
      success: false, error_message: `${res.status}: ${body.slice(0, 200)}`, owner_user_id: userId,
      latency_ms: Date.now() - started, prompt_version: PROMPT_VERSION });
    return fail(`LLM error ${res.status}. Lead remains UNSCORED.`, 502);
  }

  const data = await res.json();
  const raw = String(data?.content?.[0]?.text ?? '').replace(/```json|```/g, '').trim();

  let parsed: { budget: number; authority: number; need: number; timeline: number; reasoning: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // An unparseable response is a REAL FAILURE, not a reason to invent a placeholder.
    // This is the 5,970-fabrications lesson: never synthesise a result to keep moving.
    await logLlmCost({ agent: 'bant-qualifier', task_type: 'qualify_lead', model, provider: 'anthropic',
      input_tokens: data?.usage?.input_tokens, output_tokens: data?.usage?.output_tokens,
      success: false, error_message: `unparseable JSON: ${raw.slice(0, 160)}`,
      owner_user_id: userId, latency_ms: Date.now() - started, prompt_version: PROMPT_VERSION });
    return fail('LLM returned unparseable output. Lead remains UNSCORED — nothing was fabricated.', 502);
  }

  const clamp = (n: unknown) => Math.max(0, Math.min(25, Math.round(Number(n) || 0)));
  const b = clamp(parsed.budget), a = clamp(parsed.authority), n = clamp(parsed.need), t = clamp(parsed.timeline);
  const total = b + a + n + t;
  const reasoning = String(parsed.reasoning ?? '').trim();

  // The DB enforces this too (reasoning_required). Belt and braces: an unauditable
  // score is worse than no score.
  if (reasoning.length <= 10) return fail('Model returned a score with no reasoning. Rejected — an unauditable score is worthless.', 502);

  await db.from('bant_scores').insert({
    owner_user_id: userId, lead_id: lead.id,
    budget: b, authority: a, need: n, timeline: t, reasoning, model,
  });

  const advanced = total >= QUALIFY_BAR;
  await db.from('leads').update({
    lead_score: total,
    stage: advanced ? 'qualified' : 'new',
  }).eq('id', lead.id);

  await logLlmCost({
    agent: 'bant-qualifier', task_type: 'qualify_lead', model, provider: 'anthropic',
    input_tokens: data?.usage?.input_tokens, output_tokens: data?.usage?.output_tokens,
    latency_ms: Date.now() - started, success: true,
    selection_reason: 'bulk_classification: a bounded 0-100 scoring task over a few hundred tokens. A premium model here is a margin leak repeated per lead.',
    prompt_version: PROMPT_VERSION, business_objective: 'Qualify inbound dealer leads', owner_user_id: userId,
  });

  await logActivity({
    owner_user_id: userId, actor_type: 'ai', actor: 'bant-qualifier',
    action: 'lead_qualified', status: 'completed',
    outcome: `score ${total}/100 — ${advanced ? 'ADVANCED to qualified' : 'held at new (below bar of 40)'}`,
    evidence: `bant_scores row for lead ${lead.id}, model ${model}`, // AI completion REQUIRES evidence
  });

  return json({
    success: true, lead_id: lead.id, score: total, bar: QUALIFY_BAR,
    advanced, breakdown: { budget: b, authority: a, need: n, timeline: t },
    reasoning, model,
  });
}
