// ============================================================
// decision-engine — FK AIOS Brain: multi-dimensional decision scorer
// Real Anthropic Claude API call, real Supabase writes, real auth.
//
// v26: RLS bug FIXED — client now forwards the caller's JWT (was anon-only,
// so every insert was silently RLS-blocked; explains zero new decisions since
// Jun 26 despite UI clicks). Also carries the llmFetch Claude→Gemini fallback.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// SPRINT 4 (M1-S4): Decision Engine now routes its LLM call through the
// canonical Founder Brain instead of its own local llmFetch/callClaudeJSON.
import { reason as founderBrainReason } from '../_shared/founder-brain.ts';



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
  const result = await founderBrainReason(system, userMessage, maxTokens);
  const cleaned = result.text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(cleaned) as T; } catch { throw new Error(`Founder Brain returned non-JSON output: ${cleaned.slice(0, 300)}`); }
}

const SYSTEM_PROMPT = `You are the Decision Engine inside Franchise Kart's FK AIOS — a multi-dimensional business decision scorer for a franchise consulting and brand holding company.

Given a decision title and description, score it across exactly these 6 dimensions: Financial Impact, Strategic Fit, Execution Risk, Time to Value, Market Timing, Resource Availability.

For each dimension return a score 0-100, a weight (sum of all 6 weights must equal 1.0, weighted by how decisive that dimension is for THIS specific decision), a one-sentence assessment, and a one-sentence recommendation.

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{"dimensions":[{"name":string,"score":number,"weight":number,"assessment":string,"recommendation":string}, ...6 items],"overall_score":number,"summary":string}

overall_score is the weighted sum of the 6 dimension scores (0-100, one decimal place).`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  // RLS FIX: forward the caller's JWT so inserts run as the authenticated user.
  // Without this the client acted as anon and every insert was silently blocked
  // by RLS (authenticated-only policies) -> 500 -> tab looked dead.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: (typeof req !== 'undefined' && req.headers.get('Authorization')) || '' } } });

  try {
    const user = await verifyJWT(req.headers.get('Authorization'), supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const { title, description } = await req.json() as { title?: string; description?: string };
    if (!title || typeof title !== 'string' || title.trim().length === 0) return errRes('title is required', 400, id);

    log('info', 'Scoring decision', { title }, id);

    const result = await callClaudeJSON<{ dimensions: { name: string; score: number; weight: number; assessment: string; recommendation: string }[]; overall_score: number; summary: string }>(
      SYSTEM_PROMPT,
      `Decision title: ${title}\n\nDescription: ${description || '(no further detail provided)'}`
    );

    const { data: decision, error: decErr } = await supabase
      .from('brain_decisions')
      .insert({ user_id: user.userId, title, description: description || null, overall_score: result.overall_score })
      .select('id, title, description, overall_score, created_at')
      .single();
    if (decErr) throw decErr;

    const dimensionRows = result.dimensions.map((d) => ({ decision_id: decision.id, name: d.name, score: d.score, weight: d.weight, assessment: d.assessment, recommendation: d.recommendation }));
    const { data: dims, error: dimErr } = await supabase.from('brain_decision_dimensions').insert(dimensionRows).select('*');
    if (dimErr) throw dimErr;

    log('info', 'Decision scored', { decisionId: decision.id, overallScore: result.overall_score }, id);
    return okRes({ decision: { ...decision, summary: result.summary, dimensions: dims } }, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'decision-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
