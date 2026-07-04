// ORCHESTRATOR-BRAIN v3 — adds real research capability (Prompt 15 ResearchOS wired
// into the master pipeline). v2 could only answer from the vault or general
// knowledge; it had no path to go find live external information.
//
// New step: after classification, the model can request research_needed=true
// with a search query. If so, orchestrator-brain calls research-engine's real
// Apify integration (COSTS REAL MONEY — see cost gate below) and feeds genuine
// live results into the planning stage, instead of letting the model guess.
//
// COST GATE: research is real external spend (Apify credits). It only runs
// when the model explicitly judges live data is required AND the request
// itself asked for something research-shaped (find/search/lookup/discover) —
// never for a request that could be answered from the vault or general
// reasoning. This mirrors the finance boundary: AI decides to prepare,
// spend is bounded and logged, never silent or excessive (max 1 research
// call per orchestrator request).
//
// Verified live: an informational question ("what is our finance rule?")
// correctly triggered zero research_runs — the cost gate held.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-heartbeat-secret', 'Content-Type': 'application/json' };
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

const MODEL = 'claude-sonnet-4-6';
const INR_PER_INPUT_MTOK = 270;
const INR_PER_OUTPUT_MTOK = 1350;

const session = new Supabase.ai.Session('gte-small');
async function embed(text: string): Promise<string> {
  const out = await session.run(text, { mean_pool: true, normalize: true });
  return JSON.stringify(Array.from(out as Float32Array | number[]));
}

async function claude(apiKey: string, system: string, user: string, maxTokens = 1200) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`); }
  const data = await res.json() as any;
  return { text: data.content?.[0]?.text ?? '', inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
}

function extractJson(raw: string): any {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : raw.trim();
  const start = s.indexOf('{');
  return JSON.parse(start > 0 ? s.slice(start) : s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const t0 = Date.now();
  try {
    const secret = Deno.env.get('HEARTBEAT_SECRET');
    const provided = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    const authHeader = req.headers.get('Authorization');
    if (secret && provided !== secret && !authHeader) return err('Unauthorized', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return err('Missing ANTHROPIC_API_KEY');
    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!);

    const body = await req.json().catch(() => ({}));
    const requestText: string = body.request ?? '';
    if (!requestText.trim()) return err('request is required', 400);
    const requestedBy = body.requested_by ?? 'founder';
    const allowResearch = body.allow_research !== false;

    const { data: reqRow } = await db.from('orchestrator_requests').insert({ raw_request: requestText, requested_by: requestedBy, status: 'processing' }).select('id').single();
    const requestId = reqRow?.id;

    async function finish(patch: Record<string, unknown>) {
      if (requestId) await db.from('orchestrator_requests').update({ ...patch, latency_ms: Date.now() - t0 }).eq('id', requestId);
    }
    async function logExec(action: string, status: string, inputSummary: string, outputSummary: string, deptCode?: string, tokens?: { in: number; out: number }) {
      try {
        await db.from('execution_log').insert({
          function_name: 'orchestrator-brain', department_code: deptCode ?? null, action, status,
          input_summary: inputSummary.slice(0, 500), output_summary: outputSummary.slice(0, 500),
          model: tokens ? MODEL : null, input_tokens: tokens?.in ?? null, output_tokens: tokens?.out ?? null,
          cost_estimate_inr: tokens ? (tokens.in / 1_000_000) * INR_PER_INPUT_MTOK + (tokens.out / 1_000_000) * INR_PER_OUTPUT_MTOK : null,
        });
      } catch (_) {}
    }

    const { data: departments } = await db.from('departments').select('code, name, mission, automation_level').eq('is_active', true);
    const deptList = (departments ?? []).map((d: any) => `${d.code}: ${d.mission}`).join('\n');

    let totalInTok = 0, totalOutTok = 0;

    const classifySystem = `You are the classification stage of FKAIOS's master orchestrator. Given a request, output ONLY JSON (no markdown fences):
{"department_code": one of [${(departments ?? []).map((d: any) => d.code).join(', ')}], "risk_level": "low"|"medium"|"high", "summary": "one sentence restating the request", "needs_vault_lookup": true|false, "needs_live_research": true|false, "research_query": "short search query if needs_live_research, else null"}

Departments:
${deptList}

risk_level "high" means the request itself asks to EXECUTE a money movement, sign a contract, or make an external commitment right now.

needs_live_research=true ONLY if the request asks to find/discover/search for CURRENT external information not likely in internal records — e.g. "find furniture dealers in Chandigarh", "search for franchise leads in Pune", "who are our competitors in X city". Do NOT set true for questions about internal policy, existing data, or general reasoning — that's needs_vault_lookup instead. Live research costs real money, so only request it when genuinely necessary.`;
    const classifyResult = await claude(anthropicKey, classifySystem, requestText, 400);
    totalInTok += classifyResult.inputTokens; totalOutTok += classifyResult.outputTokens;
    let classification: any;
    try { classification = extractJson(classifyResult.text); } catch {
      await finish({ status: 'failed', result_summary: 'Classification failed to parse' });
      await logExec('classify', 'failure', requestText, classifyResult.text);
      return err('Classification failed');
    }
    await logExec('classify', 'success', requestText, JSON.stringify(classification), classification.department_code, { in: classifyResult.inputTokens, out: classifyResult.outputTokens });

    let vaultMatches: any[] = [];
    if (classification.needs_vault_lookup !== false) {
      try {
        const qEmbed = await embed(requestText);
        const { data: matches } = await db.rpc('match_knowledge_chunks', { query_embedding: qEmbed, match_count: 4, filter_brand_id: null });
        vaultMatches = (matches ?? []).filter((m: any) => m.similarity > 0.3);
      } catch (_) {}
    }

    let researchResults: any[] = [];
    let researchRunId: string | null = null;
    if (allowResearch && classification.needs_live_research === true && classification.research_query) {
      try {
        const researchUrl = `${supabaseUrl}/functions/v1/research-engine`;
        const rRes = await fetch(`${researchUrl}?secret=${secret}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'run', query: classification.research_query, requested_by: requestedBy }),
        });
        if (rRes.ok) {
          const rData = await rRes.json();
          researchResults = rData.results ?? [];
          researchRunId = rData.run_id ?? null;
          await logExec('live_research', 'success', classification.research_query, `${researchResults.length} results, run ${researchRunId}`, classification.department_code);
        } else {
          const errText = await rRes.text();
          await logExec('live_research', 'failure', classification.research_query, '', errText.slice(0, 300));
        }
      } catch (rErr) {
        await logExec('live_research', 'failure', classification.research_query, '', rErr instanceof Error ? rErr.message : String(rErr));
      }
    }

    const vaultContext = vaultMatches.length > 0
      ? vaultMatches.map((m: any, i: number) => `[V${i + 1}] ${m.chunk_text}`).join('\n\n')
      : 'No relevant vault knowledge found.';
    const researchContext = researchResults.length > 0
      ? researchResults.map((r: any, i: number) => `[R${i + 1}] ${JSON.stringify(r).slice(0, 400)}`).join('\n\n')
      : (classification.needs_live_research ? 'Live research was requested but returned no usable results.' : 'No live research performed for this request.');

    const { data: deptRow } = await db.from('departments').select('id, code, automation_level').eq('code', classification.department_code).maybeSingle();
    let targetAgent: any = null;
    if (deptRow) {
      const { data: agents } = await db.from('ai_agents').select('id, name, task, autonomy_level, permissions').eq('department_id', deptRow.id).eq('is_active', true).limit(5);
      targetAgent = (agents ?? [])[0] ?? null;
    }
    const autonomyLevel = targetAgent?.autonomy_level ?? deptRow?.automation_level ?? 1;

    const planSystem = `You are the planning stage of FKAIOS's master orchestrator, acting for department ${classification.department_code}${targetAgent ? ` via agent "${targetAgent.name}"` : ''}.

GROUND TRUTH FROM THE KNOWLEDGE VAULT (internal, verified):
${vaultContext}

LIVE EXTERNAL RESEARCH RESULTS (if any, real-time from the web):
${researchContext}

The agent handling this request has autonomy level ${autonomyLevel} (0-5 scale). Level 0-3 = answer or prepare directly, no approval needed even for informational or analytical output. Level 4-5 = the agent must NOT autonomously EXECUTE a real-world action (sending money, signing a proposal, spending on ads, committing the company) — those specific action types require human approval. Answering questions, explaining policy, summarizing data, or drafting content for review is NOT an action requiring approval, even at Level 4-5 — only set requires_approval=true if you are being asked to actually DO the money-moving / commitment-making thing right now.

Output ONLY JSON (no markdown fences):
{"plan": "1-2 sentences on what you will do", "response": "the actual answer/draft/output for this request, grounded only in vault context + research results + general reasoning — cite [V1] or [R1] style tags when using them", "requires_approval": true|false, "approval_reason": "if requires_approval, why", "amount_inr": number or null}`;
    const planResult = await claude(anthropicKey, planSystem, requestText, 1500);
    totalInTok += planResult.inputTokens; totalOutTok += planResult.outputTokens;
    let plan: any;
    try { plan = extractJson(planResult.text); } catch {
      await finish({ status: 'failed', classification: classification.department_code, department_code: classification.department_code, result_summary: 'Planning failed to parse' });
      await logExec('plan', 'failure', requestText, planResult.text, classification.department_code);
      return err('Planning failed');
    }

    const hasRealMoney = typeof plan.amount_inr === 'number' && plan.amount_inr > 0;
    const mustApprove = plan.requires_approval === true || hasRealMoney;

    let actionTaken: string;
    let approvalId: string | null = null;

    if (mustApprove) {
      const { data: approval } = await db.from('approvals').insert({
        requested_by_agent: targetAgent?.id ?? null,
        department_code: classification.department_code,
        action_type: 'orchestrator_prepared_action',
        payload: { request: requestText, response: plan.response, plan: plan.plan },
        risk_level: classification.risk_level ?? 'medium',
        amount_inr: plan.amount_inr ?? null,
        reason: plan.approval_reason ?? (hasRealMoney ? 'Real money amount proposed — requires MD approval' : 'Model flagged this action as requiring approval'),
      }).select('id').single();
      approvalId = approval?.id ?? null;
      actionTaken = 'filed_for_approval';
    } else {
      actionTaken = 'answered_only';
    }

    await logExec('plan_and_execute', 'success', requestText, plan.response?.slice(0, 300) ?? '', classification.department_code, { in: planResult.inputTokens, out: planResult.outputTokens });

    await finish({
      classification: classification.summary,
      department_code: classification.department_code,
      target_agent_id: targetAgent?.id ?? null,
      vault_sources_used: vaultMatches.length,
      plan: plan.plan,
      risk_level: classification.risk_level,
      autonomy_level_required: autonomyLevel,
      action_taken: actionTaken,
      result_summary: plan.response?.slice(0, 1000) ?? '',
      approval_id: approvalId,
      status: mustApprove ? 'awaiting_approval' : 'completed',
      input_tokens: totalInTok,
      output_tokens: totalOutTok,
      cost_estimate_inr: (totalInTok / 1_000_000) * INR_PER_INPUT_MTOK + (totalOutTok / 1_000_000) * INR_PER_OUTPUT_MTOK,
    });

    return ok({
      request_id: requestId,
      classification: classification.summary,
      department: classification.department_code,
      agent: targetAgent?.name ?? null,
      autonomy_level: autonomyLevel,
      vault_sources: vaultMatches.length,
      research_performed: researchResults.length > 0,
      research_run_id: researchRunId,
      research_result_count: researchResults.length,
      plan: plan.plan,
      action_taken: actionTaken,
      response: plan.response,
      approval_id: approvalId,
      status: mustApprove ? 'awaiting_approval' : 'completed',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('ORCHESTRATOR-BRAIN ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
