// staff-engine v24 — FIX: forward caller's JWT so RLS (TO authenticated on
// brain_staff_reports) passes. Was using anon-only client -> every insert 500'd.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID' };
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
async function callClaudeJSON<T>(system: string, userMessage: string, maxTokens = 1500): Promise<T> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured as a Supabase secret');
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] }) });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json() as { content: { type: string; text?: string }[] };
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(cleaned) as T; } catch { throw new Error(`Claude returned non-JSON output: ${cleaned.slice(0, 300)}`); }
}

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

    const body = await req.json() as { action?: string; brandId?: string; type?: string };
    if (body.action !== 'generate_report') return errRes(`Unsupported action: ${body.action}`, 400, id);
    const reportType = body.type || 'daily';

    let brand: { id: string; name: string } | null = null;
    if (body.brandId) {
      const { data } = await supabase.from('brain_brands').select('id, name').eq('id', body.brandId).single();
      brand = data || null;
    }

    const sinceIso = new Date(Date.now() - (reportType === 'weekly' ? 7 : 1) * 86400000).toISOString();
    const leadsQ = supabase.from('leads').select('id, company_name, stage, lead_score, created_at').gte('created_at', sinceIso);
    const decisionsQ = supabase.from('brain_decisions').select('title, overall_score').gte('created_at', sinceIso).limit(10);
    const ideasQ = supabase.from('brain_business_ideas').select('title, score, status').gte('created_at', sinceIso).limit(10);
    const dispatchQ = supabase.from('agent_dispatch_log').select('action, status').gte('created_at', sinceIso).limit(100);

    const [{ data: leads }, { data: decisions }, { data: ideas }, { data: dispatches }] = await Promise.all([leadsQ, decisionsQ, ideasQ, dispatchQ]);

    const leadsCtx = (leads || []).map((l) => `${l.company_name} — ${l.stage} (score ${l.lead_score})`).join('; ') || 'none';
    const decisionsCtx = (decisions || []).map((d) => `${d.title} (${d.overall_score})`).join('; ') || 'none';
    const ideasCtx = (ideas || []).map((i) => `${i.title} (${i.score}, ${i.status})`).join('; ') || 'none';
    const dispatchSummary = dispatches && dispatches.length > 0
      ? `${dispatches.length} agent actions ran (${dispatches.filter((d) => d.status === 'completed').length} completed, ${dispatches.filter((d) => d.status === 'failed').length} failed)`
      : 'No agent actions logged in this period';

    const result = await callClaudeJSON<{ content: string; priorities: string[] }>(
      `You are the Chief of Staff AI at Franchise Kart, writing a ${reportType} founder briefing${brand ? ` for the brand "${brand.name}"` : ' covering the whole company'}. Be direct, concise, and grounded only in the real data given — no invented numbers. If a section has no data, say so plainly rather than padding.\n\nRespond with ONLY valid JSON: {"content": string (the briefing, 4-6 sentences), "priorities": string[] (3-5 concrete next actions)}`,
      `New leads in period: ${leadsCtx}\nDecisions scored: ${decisionsCtx}\nBusiness ideas evaluated: ${ideasCtx}\nAgent automation activity: ${dispatchSummary}`
    );

    const { data: report, error: repErr } = await supabase
      .from('brain_staff_reports')
      .insert({ user_id: user.userId, brand_id: body.brandId || null, type: reportType, content: result.content, priorities: result.priorities })
      .select('*, brand:brain_brands(name, color, icon)')
      .single();
    if (repErr) throw repErr;

    log('info', 'Staff report generated', { reportId: report.id, type: reportType }, id);
    return okRes({ report }, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'staff-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
