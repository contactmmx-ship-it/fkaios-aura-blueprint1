// training-engine v2 — Phase 5 of the Founder Vision Audit roadmap, plus
// added shared HEARTBEAT_SECRET auth path (additive, same pattern used
// across heartbeat-engine/vault-engine/agent-scheduler) so this can be
// triggered by cron/admin scripts, not only a logged-in user.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function llmFetch(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  let errMsg = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) return res;
    errMsg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) { errMsg = e instanceof Error ? e.message : String(e); }
  const sys = typeof payload.system === 'string' ? payload.system : '';
  const msgs = Array.isArray(payload.messages) ? payload.messages : [];
  const openaiStyleMessages = [ ...(sys ? [{ role: 'system', content: sys }] : []), ...msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })) ];
  const gKey = Deno.env.get('GEMINI_API_KEY');
  if (gKey) {
    const contents = msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] }));
    try {
      const gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', { method: 'POST', headers: { 'x-goog-api-key': gKey, 'content-type': 'application/json' }, body: JSON.stringify({ ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}), contents, generationConfig: { maxOutputTokens: Number(payload.max_tokens ?? 1024) + 256, thinkingConfig: { thinkingBudget: 0 } } }) });
      if (gRes.ok) {
        const g = await gRes.json() as any;
        const text = (g.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
        return new Response(JSON.stringify({ model: 'gemini-2.5-flash', content: [{ type: 'text', text }], usage: { input_tokens: g.usageMetadata?.promptTokenCount ?? 0, output_tokens: g.usageMetadata?.candidatesTokenCount ?? 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    } catch (_) {}
  }
  const compatProviders = [
    { envKey: 'open_ai_key', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    { envKey: 'ZHIPU_API_key', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-plus' },
    { envKey: 'deepseek key', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  ];
  for (const p of compatProviders) {
    const key = Deno.env.get(p.envKey);
    if (!key) continue;
    try {
      const res = await fetch(p.url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: p.model, max_tokens: payload.max_tokens ?? 1024, messages: openaiStyleMessages }) });
      if (res.ok) {
        const d = await res.json() as any;
        const text = d.choices?.[0]?.message?.content ?? '';
        return new Response(JSON.stringify({ model: p.model, content: [{ type: 'text', text }], usage: { input_tokens: d.usage?.prompt_tokens ?? 0, output_tokens: d.usage?.completion_tokens ?? 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    } catch (_) {}
  }
  return new Response(JSON.stringify({ error: errMsg || 'All providers failed' }), { status: 502, headers: { 'content-type': 'application/json' } });
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

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID, x-heartbeat-secret' };
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>, id?: string) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: id || '', message, ...(data ? { data } : {}) })); }
function errRes(message: string, status: number, id?: string): Response { log('ERROR', message, undefined, id); return new Response(JSON.stringify({ error: message, correlationId: id }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function okRes(data: unknown, id?: string): Response { return new Response(JSON.stringify({ ...(data as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
async function verifyJWT(authHeader: string | null, supabaseUrl: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}
async function callClaudeText(system: string, userMessage: string, maxTokens = 1500): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await llmFetch(apiKey, { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] });
  if (!res.ok) { const t = await res.text(); throw new Error(`LLM error ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json() as { content: { type: string; text?: string }[] };
  return data.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');

  const heartbeatSecret = Deno.env.get('HEARTBEAT_SECRET');
  const providedSecret = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
  const secretOk = !!heartbeatSecret && providedSecret === heartbeatSecret;

  const db = createClient(supabaseUrl, secretOk && supabaseServiceKey ? supabaseServiceKey : supabaseAnonKey, { global: { headers: authHeader && !secretOk ? { Authorization: authHeader } : {} } });

  try {
    const user = secretOk ? { userId: 'heartbeat_secret' } : await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const body = await req.json() as { action?: string; title?: string; format?: string; department_code?: string; source_text?: string; agent_id?: string; module_id?: string; score?: number };

    if (body.action === 'generate_module') {
      const { title, format, department_code, source_text } = body;
      if (!title || !format) return errRes('title and format are required', 400, id);
      if (!['ppt', 'quiz', 'session', 'sop_update'].includes(format)) return errRes("format must be one of: ppt, quiz, session, sop_update", 400, id);

      const FORMAT_PROMPTS: Record<string, string> = {
        ppt: 'Produce a slide-by-slide outline (title + 3-5 bullet points per slide, 6-10 slides) for a training presentation. Real, specific content only — no filler bullets.',
        quiz: 'Produce a 5-question quiz (multiple choice, 4 options each, mark the correct answer) testing understanding of this topic.',
        session: 'Produce a structured training session outline: objectives, agenda with timing, and a facilitator script summary.',
        sop_update: 'Produce a clear SOP update memo: what changed, why, and what agents must now do differently.',
      };

      const principlesBlock = await getFounderPrinciplesBlock(db, 'TRAINING');
      const content = await callClaudeText(
        `You are the Training Department at Franchise Kart's FK AIOS, producing real training material for the AI workforce. ${FORMAT_PROMPTS[format]} Ground it in the source material given if any; otherwise write general best-practice content for the topic — never invent company-specific numbers you weren't given.${principlesBlock}`,
        `Title: ${title}\nDepartment: ${department_code || 'general'}\n${source_text ? `Source material:\n${source_text}` : 'No source material given — use general best practice.'}`
      );

      const { data: module, error: modErr } = await db.from('training_curriculum').insert({ title, format, department_code: department_code ?? null, content, created_by_agent: 'training-engine' }).select('id').single();
      if (modErr) throw modErr;

      log('info', 'Training module generated', { moduleId: module.id, format }, id);
      return okRes({ module_id: module.id, title, format, content }, id);
    }

    if (body.action === 'mark_completed') {
      const { agent_id, module_id, score } = body;
      if (!agent_id || !module_id) return errRes('agent_id and module_id are required', 400, id);
      const { data: completion, error: compErr } = await db.from('training_completions').insert({ agent_id, module_id, score: score ?? null }).select('id').single();
      if (compErr) throw compErr;
      log('info', 'Training completion recorded', { agentId: agent_id, moduleId: module_id }, id);
      return okRes({ completion_id: completion.id }, id);
    }

    if (body.action === 'get_completion_stats') {
      const { data: modules } = await db.from('training_curriculum').select('id, title, format');
      const { data: completions } = await db.from('training_completions').select('agent_id, module_id, score');
      const { count: totalAgents } = await db.from('ai_agents').select('id', { count: 'exact', head: true }).eq('is_active', true);
      const completedAgentIds = new Set((completions ?? []).map((c: any) => c.agent_id));
      const avgScore = completions && completions.length > 0 ? Math.round((completions.reduce((s: number, c: any) => s + (c.score || 0), 0) / completions.filter((c: any) => c.score != null).length || 0) * 10) / 10 : null;
      return okRes({ modules_published: (modules ?? []).length, completions_total: (completions ?? []).length, agents_with_at_least_one_completion: completedAgentIds.size, total_active_agents: totalAgents ?? 0, avg_quiz_score: avgScore }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'training-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
