// business-engine v38 — Phase 3: generate_lead_proposal action wires the
// Proposal + Business Model departments into the front of the revenue chain,
// ahead of closer-engine's close_deal. Real lead/brand data only, no invented
// pricing — proposed_amount_inr is null if the model can't justify a number.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function llmFetch(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  let errMsg = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res;
    errMsg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  const sys = typeof payload.system === 'string' ? payload.system : '';
  const msgs = Array.isArray(payload.messages) ? payload.messages : [];
  const openaiStyleMessages = [
    ...(sys ? [{ role: 'system', content: sys }] : []),
    ...msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
  ];
  const gKey = Deno.env.get('GEMINI_API_KEY');
  if (gKey) {
    console.log('LLM FALLBACK to gemini-2.5-flash —', errMsg.slice(0, 150));
    const contents = msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] }));
    try {
      const gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: { 'x-goog-api-key': gKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
          contents,
          generationConfig: { maxOutputTokens: Number(payload.max_tokens ?? 1024) + 256, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (gRes.ok) {
        const g = await gRes.json() as any;
        const text = (g.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
        return new Response(JSON.stringify({ model: 'gemini-2.5-flash', content: [{ type: 'text', text }], usage: { input_tokens: g.usageMetadata?.promptTokenCount ?? 0, output_tokens: g.usageMetadata?.candidatesTokenCount ?? 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      errMsg = `${errMsg} | Gemini ${gRes.status}: ${(await gRes.text()).slice(0, 200)}`;
    } catch (e) {
      errMsg = `${errMsg} | Gemini: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const compatProviders = [
    { name: 'OpenAI', envKey: 'open_ai_key', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    { name: 'GLM', envKey: 'ZHIPU_API_key', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-plus' },
    { name: 'DeepSeek', envKey: 'deepseek key', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  ];
  for (const p of compatProviders) {
    const key = Deno.env.get(p.envKey);
    if (!key) continue;
    console.log(`LLM FALLBACK to ${p.model} —`, errMsg.slice(0, 150));
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: p.model, max_tokens: payload.max_tokens ?? 1024, messages: openaiStyleMessages }),
      });
      if (res.ok) {
        const d = await res.json() as any;
        const text = d.choices?.[0]?.message?.content ?? '';
        return new Response(JSON.stringify({ model: p.model, content: [{ type: 'text', text }], usage: { input_tokens: d.usage?.prompt_tokens ?? 0, output_tokens: d.usage?.completion_tokens ?? 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      errMsg = `${errMsg} | ${p.name} ${res.status}: ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      errMsg = `${errMsg} | ${p.name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return new Response(JSON.stringify({ error: errMsg }), { status: 502, headers: { 'content-type': 'application/json' } });
}

async function getFounderPrinciplesBlock(supabase: any, agentName: string): Promise<string> {
  try {
    const { data, error } = await supabase.from('founder_principles').select('principle, weight, applies_to').eq('active', true).order('weight', { ascending: false });
    if (error || !data) return '';
    const relevant = data.filter((p: any) => Array.isArray(p.applies_to) && (p.applies_to.includes('*') || p.applies_to.includes(agentName)));
    if (relevant.length === 0) return '';
    return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${relevant.map((p: any) => `- ${p.principle}`).join('\n')}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
  } catch { return ''; }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID',
};
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>, id?: string) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: id || '', message, ...(data ? { data } : {}) }));
}
function errRes(message: string, status: number, id?: string): Response {
  log('ERROR', message, undefined, id);
  return new Response(JSON.stringify({ error: message, correlationId: id }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function okRes(data: unknown, id?: string): Response {
  return new Response(JSON.stringify({ ...(data as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
async function verifyJWT(authHeader: string | null, supabaseUrl: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}
async function callClaudeJSON<T>(system: string, userMessage: string, maxTokens = 1500): Promise<T> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await llmFetch(apiKey, { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json() as { content: { type: string; text?: string }[] };
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(cleaned) as T; } catch { throw new Error(`Claude returned non-JSON output: ${cleaned.slice(0, 300)}`); }
}
async function callClaudeText(system: string, userMessage: string, maxTokens = 1200): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await llmFetch(apiKey, { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json() as { content: { type: string; text?: string }[] };
  return data.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
}

const BASE_SYSTEM_PROMPT = `You are the Business Creator engine inside Franchise Kart's FK AIOS, evaluating new business/brand ideas for a franchise consulting and multi-brand holding company (existing brands: Mr. Chick'n, GoMax, Gio Paints, Arofur, Chaat Masters, Chawla Lab, Turning Point).

Given an idea title and description, evaluate it like a franchise investment committee would: market size in India, franchisability, capital intensity, competitive landscape, fit with the existing brand portfolio.

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{"industry":string,"score":number (0-100),"status":"idea"|"validated"|"rejected","analysis":string (3-5 sentences covering market size, franchisability, key risk, and a verdict)}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });

  try {
    const user = await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const body = await req.json() as { action?: string; title?: string; description?: string; idea_id?: string; document_type?: string; lead_id?: string };

    if (body.action === 'generate_lead_proposal') {
      const { lead_id } = body;
      if (!lead_id) return errRes('lead_id is required', 400, id);

      const { data: lead, error: leadErr } = await supabase.from('leads').select('*, brand:brand_id(name, sector, investment_range, royalty, investment_min, investment_max)').eq('id', lead_id).single();
      if (leadErr || !lead) return errRes('Lead not found', 404, id);

      const leadCtx = `Company: ${lead.company_name}\nContact: ${lead.contact_name || 'not given'}\nLocation: ${lead.location || lead.city || 'not given'}\nStated investment capacity: ${lead.investment_capacity || 'not given'}\nBrand interest: ${lead.brand?.name || 'unspecified'} (${lead.brand?.sector || ''})\nBrand investment range: ${lead.brand?.investment_range || (lead.brand?.investment_min && lead.brand?.investment_max ? `₹${lead.brand.investment_min}-₹${lead.brand.investment_max}` : 'not set')}\nBrand royalty: ${lead.brand?.royalty || 'not set'}\nStage: ${lead.stage}\nNotes: ${lead.notes || 'none'}`;

      const proposalPrinciples = await getFounderPrinciplesBlock(supabase, 'PROPOSAL');
      const proposalText = await callClaudeText(
        `You are the Proposal Department at Franchise Kart, drafting a real franchise proposal for a specific prospect. Write in clear prose sections: opening summary, why this brand fits their profile, what's included in the franchise package, and next steps. Ground everything in the real lead and brand data given — never invent figures not present in it; write [To be confirmed] for anything not given.${proposalPrinciples}`,
        leadCtx
      );

      const bizPrinciples = await getFounderPrinciplesBlock(supabase, 'BIZMODEL');
      const bizResult = await callClaudeJSON<{ content: string; proposed_amount_inr: number | null }>(
        `You are the Business Model Department at Franchise Kart, producing the commercial terms for a specific prospect's franchise deal: franchise fee, royalty structure, and total investment required. Ground every figure in the brand's real investment range and royalty given — if you cannot justify a specific total figure from the data given, set proposed_amount_inr to null rather than inventing one. Respond with ONLY valid JSON: {"content": string (3-5 sentences, the commercial terms in prose), "proposed_amount_inr": number or null}${bizPrinciples}`,
        leadCtx
      );

      const { data: propDoc, error: propErr } = await supabase.from('lead_documents').insert({ lead_id, document_type: 'proposal', content: proposalText, department_code: 'PROPOSAL', generated_by: user.userId }).select('id').single();
      if (propErr) throw propErr;
      const { data: bizDoc, error: bizErr } = await supabase.from('lead_documents').insert({ lead_id, document_type: 'business_model', content: bizResult.content, proposed_amount_inr: bizResult.proposed_amount_inr, department_code: 'BIZMODEL', generated_by: user.userId }).select('id').single();
      if (bizErr) throw bizErr;

      if (lead.stage === 'new' || lead.stage === 'contacted' || lead.stage === 'qualified') {
        await supabase.from('leads').update({ stage: 'proposal_sent' }).eq('id', lead_id);
      }
      await supabase.from('lead_activities').insert({ lead_id, type: 'note', note: `Proposal (${propDoc.id}) and commercial terms (${bizDoc.id}) generated by Proposal + Business Model departments.${bizResult.proposed_amount_inr ? ` Proposed amount: ₹${bizResult.proposed_amount_inr.toLocaleString('en-IN')}.` : ' No amount could be justified from real data — flagged for manual pricing.'}` });

      log('info', 'Lead proposal + business model generated', { leadId: lead_id, proposedAmount: bizResult.proposed_amount_inr }, id);
      return okRes({ proposal: { id: propDoc.id, content: proposalText }, business_model: { id: bizDoc.id, content: bizResult.content, proposed_amount_inr: bizResult.proposed_amount_inr }, lead_stage: 'proposal_sent', next_step: 'When the prospect accepts, Sales calls closer-engine close_deal with this proposed amount to draft the invoice.' }, id);
    }

    if (body.action === 'generate_document') {
      const { idea_id, document_type } = body;
      if (!idea_id || !document_type) return errRes('idea_id and document_type are required', 400, id);
      const DOC_PROMPTS: Record<string, string> = {
        'Business Model Canvas': 'Produce a Business Model Canvas for this idea: key partners, key activities, value proposition, customer relationships, customer segments, key resources, channels, cost structure, revenue streams. One or two concrete sentences per block, grounded in the idea and analysis given — no generic filler.',
        'Franchise Model': 'Produce a franchise model outline for this idea: franchise fee range, royalty structure, territory rights approach, support package contents, and total investment range. If a real number cannot be justified from the idea context, write [To be confirmed] rather than inventing one.',
        'Standard Operating Procedures': 'Produce a Standard Operating Procedures outline for this idea: setup phase steps, daily operations checklist, and quality control checkpoints. Concrete and actionable, not generic advice.',
        'Marketing Plan': 'Produce a marketing plan for this idea: primary channels, a 4-week content calendar theme outline, customer acquisition funnel stages, and core brand positioning statement.',
      };
      const promptBody = DOC_PROMPTS[document_type];
      if (!promptBody) return errRes(`Unknown document_type: ${document_type}`, 400, id);

      const { data: idea, error: ideaFetchErr } = await supabase.from('brain_business_ideas').select('title, description, industry, score, status').eq('id', idea_id).single();
      if (ideaFetchErr || !idea) return errRes('Idea not found', 404, id);

      const principlesBlock = await getFounderPrinciplesBlock(supabase, 'business-engine');
      const docText = await callClaudeText(
        `You are a franchise business consultant producing a real working document. ${promptBody} Write in clear prose/short sections, not JSON. Never invent financial figures you cannot justify — write [To be confirmed] instead.${principlesBlock}`,
        `Idea: ${idea.title}\nIndustry: ${idea.industry}\nScore: ${idea.score}/100 (${idea.status})\nAnalysis: ${idea.description}`
      );

      const { data: updated } = await supabase.from('brain_business_ideas').select('generated_docs').eq('id', idea_id).single();
      const existingDocs = (updated?.generated_docs as Record<string, string>) ?? {};
      const newDocs = { ...existingDocs, [document_type]: docText };
      const { error: saveErr } = await supabase.from('brain_business_ideas').update({ generated_docs: newDocs }).eq('id', idea_id);
      if (saveErr) throw saveErr;

      log('info', 'Document generated', { ideaId: idea_id, documentType: document_type }, id);
      return okRes({ document_type, content: docText }, id);
    }

    const { title, description } = body;
    if (!title || typeof title !== 'string' || title.trim().length === 0) return errRes('title is required', 400, id);

    log('info', 'Evaluating business idea', { title }, id);

    const principlesBlock = await getFounderPrinciplesBlock(supabase, 'business-engine');
    const systemPrompt = BASE_SYSTEM_PROMPT + principlesBlock;

    const result = await callClaudeJSON<{ industry: string; score: number; status: string; analysis: string }>(
      systemPrompt,
      `Idea title: ${title}\n\nDescription: ${description || '(no further detail provided)'}`
    );

    const { data: idea, error: ideaErr } = await supabase
      .from('brain_business_ideas')
      .insert({ user_id: user.userId, title, description: result.analysis, industry: result.industry, score: result.score, status: result.status })
      .select('*')
      .single();
    if (ideaErr) throw ideaErr;

    log('info', 'Idea scored', { ideaId: idea.id, score: result.score }, id);
    return okRes({ idea }, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'business-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
