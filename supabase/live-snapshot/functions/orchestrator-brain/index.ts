// ORCHESTRATOR-BRAIN v9 — Founder Intelligence Layer added (founder_principles
// injected into both the classification and planning LLM stages).
// v8: full 5-tier LLM provider fallback chain (Claude -> Gemini -> OpenAI ->
// GLM -> DeepSeek). Real secret names confirmed live 2026-07-07.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-heartbeat-secret', 'Content-Type': 'application/json' };
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const GEMINI_MODEL = 'gemini-2.5-flash';
const OPENAI_MODEL = 'gpt-4o-mini';
const GLM_MODEL = 'glm-4-plus';
const DEEPSEEK_MODEL = 'deepseek-chat';
const RATES: Record<string, { inp: number; out: number }> = {
  [ANTHROPIC_MODEL]: { inp: 270, out: 1350 },
  [GEMINI_MODEL]: { inp: 27, out: 220 },
  [OPENAI_MODEL]: { inp: 13, out: 53 },
  [GLM_MODEL]: { inp: 40, out: 40 },
  [DEEPSEEK_MODEL]: { inp: 12, out: 25 },
};

const session = new Supabase.ai.Session('gte-small');
async function embed(text: string): Promise<string> {
  const out = await session.run(text, { mean_pool: true, normalize: true });
  return JSON.stringify(Array.from(out as Float32Array | number[]));
}

async function getFounderPrinciplesBlock(db: any, agentName: string): Promise<string> {
  try {
    const { data, error } = await db.from('founder_principles').select('principle, weight, applies_to').eq('active', true).order('weight', { ascending: false });
    if (error || !data) return '';
    const relevant = data.filter((p: any) => Array.isArray(p.applies_to) && (p.applies_to.includes('*') || p.applies_to.includes(agentName)));
    if (relevant.length === 0) return '';
    return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${relevant.map((p: any) => `- ${p.principle}`).join('\n')}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
  } catch { return ''; }
}

interface LLMResult { text: string; inputTokens: number; outputTokens: number; model: string; provider: string; fellBack: boolean; }

async function callAnthropic(apiKey: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`); }
  const data = await res.json() as any;
  return { text: data.content?.[0]?.text ?? '', inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0, model: ANTHROPIC_MODEL, provider: 'anthropic', fellBack: false };
}

async function callGemini(apiKey: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens + 256, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`); }
  const data = await res.json() as any;
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  return { text, inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0, model: GEMINI_MODEL, provider: 'gemini', fellBack: false };
}

async function callOpenAI(apiKey: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`); }
  const data = await res.json() as any;
  return { text: data.choices?.[0]?.message?.content ?? '', inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, model: OPENAI_MODEL, provider: 'openai', fellBack: false };
}

async function callOpenAICompatible(url: string, model: string, key: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`${model} ${res.status}: ${t.slice(0, 300)}`); }
  const d = await res.json() as any;
  return { text: d.choices?.[0]?.message?.content ?? '', inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0, model, provider: 'openai_compat', fellBack: false };
}

function makeLLM(anthropicKey: string | undefined, geminiKey: string | undefined, openaiKey: string | undefined, forceProvider: string | null) {
  const glmKey = Deno.env.get('ZHIPU_API_key');
  const deepseekKey = Deno.env.get('deepseek key');

  return async function callLLM(system: string, user: string, maxTokens = 1200): Promise<LLMResult> {
    if (forceProvider === 'gemini') {
      if (!geminiKey) throw new Error('force_provider=gemini but GEMINI_API_KEY not set');
      return await callGemini(geminiKey, system, user, maxTokens);
    }
    if (forceProvider === 'openai') {
      if (!openaiKey) throw new Error('force_provider=openai but open_ai_key not set');
      return await callOpenAI(openaiKey, system, user, maxTokens);
    }
    const errors: string[] = [];
    if (anthropicKey) {
      try { return await callAnthropic(anthropicKey, system, user, maxTokens); }
      catch (e) { errors.push(`Anthropic: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); console.log('LLM FALLBACK: Anthropic failed, trying Gemini —', errors[errors.length - 1]); }
    }
    if (geminiKey) {
      try { const r = await callGemini(geminiKey, system, user, maxTokens); return { ...r, fellBack: true }; }
      catch (e) { errors.push(`Gemini: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); console.log('LLM FALLBACK: Gemini failed, trying OpenAI —', errors[errors.length - 1]); }
    }
    if (openaiKey) {
      try { const r = await callOpenAI(openaiKey, system, user, maxTokens); return { ...r, fellBack: true }; }
      catch (e) { errors.push(`OpenAI: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); console.log('LLM FALLBACK: OpenAI failed, trying GLM —', errors[errors.length - 1]); }
    }
    if (glmKey) {
      try { const r = await callOpenAICompatible('https://open.bigmodel.cn/api/paas/v4/chat/completions', GLM_MODEL, glmKey, system, user, maxTokens); return { ...r, fellBack: true }; }
      catch (e) { errors.push(`GLM: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); console.log('LLM FALLBACK: GLM failed, trying DeepSeek —', errors[errors.length - 1]); }
    }
    if (deepseekKey) {
      try { const r = await callOpenAICompatible('https://api.deepseek.com/chat/completions', DEEPSEEK_MODEL, deepseekKey, system, user, maxTokens); return { ...r, fellBack: true }; }
      catch (e) { errors.push(`DeepSeek: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); }
    }
    throw new Error(errors.length > 0 ? `All providers failed. ${errors.join(' | ')}` : 'No LLM API keys configured');
  };
}

function costInr(model: string, inp: number, out: number): number {
  const r = RATES[model] ?? RATES[ANTHROPIC_MODEL];
  return (inp / 1_000_000) * r.inp + (out / 1_000_000) * r.out;
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
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const openaiKey = Deno.env.get('open_ai_key');
    if (!anthropicKey && !geminiKey && !openaiKey) return err('Missing ANTHROPIC_API_KEY, GEMINI_API_KEY, and open_ai_key — at least one is required');
    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!);

    const body = await req.json().catch(() => ({}));
    const requestText: string = body.request ?? '';
    if (!requestText.trim()) return err('request is required', 400);
    const requestedBy = body.requested_by ?? 'founder';
    const allowResearch = body.allow_research !== false;
    const forceProvider: string | null = body.force_provider ?? null;
    const callLLM = makeLLM(anthropicKey, geminiKey, openaiKey, forceProvider);

    const { data: reqRow } = await db.from('orchestrator_requests').insert({ raw_request: requestText, requested_by: requestedBy, status: 'processing' }).select('id').single();
    const requestId = reqRow?.id;

    async function finish(patch: Record<string, unknown>) {
      if (requestId) await db.from('orchestrator_requests').update({ ...patch, latency_ms: Date.now() - t0 }).eq('id', requestId);
    }
    async function logExec(action: string, status: string, inputSummary: string, outputSummary: string, deptCode?: string, usage?: { in: number; out: number; model: string }) {
      try {
        await db.from('execution_log').insert({
          function_name: 'orchestrator-brain', department_code: deptCode ?? null, action, status,
          input_summary: inputSummary.slice(0, 500), output_summary: outputSummary.slice(0, 500),
          model: usage?.model ?? null, input_tokens: usage?.in ?? null, output_tokens: usage?.out ?? null,
          cost_estimate_inr: usage ? costInr(usage.model, usage.in, usage.out) : null,
        });
      } catch (_) {}
    }

    const { data: departments } = await db.from('departments').select('id, code, name, mission, automation_level').eq('is_active', true);
    const deptList = (departments ?? []).map((d: any) => `${d.code}: ${d.mission}`).join('\n');

    const { data: allAgents } = await db.from('ai_agents').select('id, name, task, autonomy_level, permissions, department_id').eq('is_active', true);
    const rosterLines: string[] = [];
    for (const d of departments ?? []) {
      const agents = (allAgents ?? []).filter((a: any) => a.department_id === d.id);
      if (agents.length > 0) rosterLines.push(`${d.code}: ${agents.map((a: any) => `${a.name} [${a.task}]`).join(', ')}`);
    }
    const rosterList = rosterLines.join('\n');

    let totalInTok = 0, totalOutTok = 0, totalCostInr = 0;
    const modelsUsed = new Set<string>();
    let anyFallback = false;
    function track(r: LLMResult) { totalInTok += r.inputTokens; totalOutTok += r.outputTokens; totalCostInr += costInr(r.model, r.inputTokens, r.outputTokens); modelsUsed.add(r.model); if (r.fellBack) anyFallback = true; }

    const classifyPrinciples = await getFounderPrinciplesBlock(db, 'orchestrator-brain');
    const classifySystem = `You are the classification stage of FKAIOS's master orchestrator. Given a request, output ONLY JSON (no markdown fences):
{"department_code": one of [${(departments ?? []).map((d: any) => d.code).join(', ')}], "agent_task": "the [TASK_CODE] of the single best-fit agent WITHIN the chosen department, exactly as listed below, or null if none fits", "risk_level": "low"|"medium"|"high", "summary": "one sentence restating the request", "needs_vault_lookup": true|false, "needs_live_research": true|false, "research_query": "short search query if needs_live_research, else null"}

Departments:
${deptList}

Agents per department (pick agent_task ONLY from the department you chose):
${rosterList}

agent_task guidance: match the request's PRIMARY intent to the agent's task code — e.g. a request to close or negotiate a deal -> CLOSE_DEAL, chasing a cold lead -> FOLLOW_UP, finding new prospects -> CAPTURE_LEADS, scoring/vetting a lead -> QUALIFY_LEAD, booking a meeting -> SCHEDULE_MEETING, writing a proposal -> GENERATE_PROPOSAL. If the request spans several agents, pick the one owning the FINAL deliverable.

risk_level "high" means the request itself asks to EXECUTE a money movement, sign a contract, or make an external commitment right now.

needs_live_research=true ONLY if the request asks to find/discover/search for CURRENT external information not likely in internal records — e.g. "find furniture dealers in Chandigarh", "search for franchise leads in Pune", "who are our competitors in X city". Do NOT set true for questions about internal policy, existing data, or general reasoning — that's needs_vault_lookup instead. Live research costs real money, so only request it when genuinely necessary.${classifyPrinciples}`;
    const classifyResult = await callLLM(classifySystem, requestText, 400);
    track(classifyResult);
    let classification: any;
    try { classification = extractJson(classifyResult.text); } catch {
      await finish({ status: 'failed', result_summary: 'Classification failed to parse' });
      await logExec('classify', 'failure', requestText, classifyResult.text, undefined, { in: classifyResult.inputTokens, out: classifyResult.outputTokens, model: classifyResult.model });
      return err('Classification failed');
    }
    await logExec('classify', classifyResult.fellBack ? 'success_fallback' : 'success', requestText, JSON.stringify(classification), classification.department_code, { in: classifyResult.inputTokens, out: classifyResult.outputTokens, model: classifyResult.model });

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

    const deptRow = (departments ?? []).find((d: any) => d.code === classification.department_code) ?? null;
    let targetAgent: any = null;
    let routingMethod = 'none';
    if (deptRow) {
      const deptAgents = (allAgents ?? []).filter((a: any) => a.department_id === deptRow.id);
      if (classification.agent_task) {
        targetAgent = deptAgents.find((a: any) => a.task === classification.agent_task) ?? null;
        if (targetAgent) routingMethod = 'task_match';
      }
      if (!targetAgent && deptAgents.length > 0) {
        targetAgent = deptAgents[0];
        routingMethod = 'fallback_first_agent';
        await logExec('agent_routing', 'fallback', `dept=${deptRow.code} model_task=${classification.agent_task ?? 'null'}`, `fell back to ${targetAgent.name} [${targetAgent.task}]`, deptRow.code);
      }
    }
    const autonomyLevel = targetAgent?.autonomy_level ?? deptRow?.automation_level ?? 1;

    const planPrinciples = await getFounderPrinciplesBlock(db, classification.department_code ?? 'orchestrator-brain');
    const planSystem = `You are the planning stage of FKAIOS's master orchestrator, acting for department ${classification.department_code}${targetAgent ? ` as agent "${targetAgent.name}" whose job is ${targetAgent.task}` : ''}.

GROUND TRUTH FROM THE KNOWLEDGE VAULT (internal, verified):
${vaultContext}

LIVE EXTERNAL RESEARCH RESULTS (if any, real-time from the web):
${researchContext}

The agent handling this request has autonomy level ${autonomyLevel} (0-5 scale). Level 0-3 = answer or prepare directly, no approval needed even for informational or analytical output. Level 4-5 = the agent must NOT autonomously EXECUTE a real-world action (sending money, signing a proposal, spending on ads, committing the company) — those specific action types require human approval. Answering questions, explaining policy, summarizing data, or drafting content for review is NOT an action requiring approval, even at Level 4-5 — only set requires_approval=true if you are being asked to actually DO the money-moving / commitment-making thing right now.

Output ONLY JSON (no markdown fences):
{"plan": "1-2 sentences on what you will do", "response": "the actual answer/draft/output for this request, grounded only in vault context + research results + general reasoning — cite [V1] or [R1] style tags when using them", "requires_approval": true|false, "approval_reason": "if requires_approval, why", "amount_inr": number or null}${planPrinciples}`;
    const planResult = await callLLM(planSystem, requestText, 1500);
    track(planResult);
    let plan: any;
    try { plan = extractJson(planResult.text); } catch {
      await finish({ status: 'failed', classification: classification.department_code, department_code: classification.department_code, result_summary: 'Planning failed to parse' });
      await logExec('plan', 'failure', requestText, planResult.text, classification.department_code, { in: planResult.inputTokens, out: planResult.outputTokens, model: planResult.model });
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

    await logExec('plan_and_execute', planResult.fellBack ? 'success_fallback' : 'success', requestText, plan.response?.slice(0, 300) ?? '', classification.department_code, { in: planResult.inputTokens, out: planResult.outputTokens, model: planResult.model });

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
      cost_estimate_inr: totalCostInr,
    });

    return ok({
      request_id: requestId,
      classification: classification.summary,
      department: classification.department_code,
      agent: targetAgent?.name ?? null,
      agent_task: targetAgent?.task ?? null,
      routing_method: routingMethod,
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
      models_used: Array.from(modelsUsed),
      llm_fallback_used: anyFallback,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('ORCHESTRATOR-BRAIN ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
