// my-brain-engine v2 — the founder's iterative creative-project loop:
// reference material -> real brief -> Maker AI drafts -> Critic AI reviews
// and requests rectifications -> loop until the Critic approves or
// max_iterations hits -> Chief-of-Staff writes a summary for the founder ->
// founder approves/rejects/requests changes. Added HEARTBEAT_SECRET path.
//
// HONEST LIMIT, stated plainly and repeated in every relevant output: this
// engine produces TEXT deliverables — briefs, specs, scripts, prompts ready
// to hand to a real video/3D/design tool. It does NOT render video, 3D
// models, or images beyond what Gemini's static image generation can do.
// A 'video_brief' deliverable is a production-ready brief, not a video file.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// SPRINT 4 (M1-S4): My Brain now routes its LLM call through the canonical
// Founder Brain instead of its own local llmFetch/callClaude.
import { reason as founderBrainReason } from '../_shared/founder-brain.ts';

async function callClaude(system: string, userMsg: string, maxTokens = 1800): Promise<string> {
  const result = await founderBrainReason(system, userMsg, maxTokens);
  return result.text.trim();
}

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID, x-heartbeat-secret' };
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function errRes(m: string, s: number, id?: string): Response { return new Response(JSON.stringify({ error: m, correlationId: id }), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function okRes(d: unknown, id?: string): Response { return new Response(JSON.stringify({ ...(d as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
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

const HONEST_LIMIT = "IMPORTANT: You are producing a TEXT deliverable only — a detailed brief, script, shot list, or spec. You cannot render video, 3D models, or animation. If the deliverable type implies video/3D, produce a production-ready brief detailed enough to hand to a human video editor or a real video-generation tool (e.g. Runway, Pika) or 3D artist — not a description of a finished video as if it exists.";

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

    const body = await req.json() as {
      action?: string; title?: string; client_name?: string; deliverable_type?: string;
      reference_type?: string; reference_url?: string; reference_text?: string; brief_input?: string;
      project_id?: string; decision?: string; founder_notes?: string;
    };

    if (body.action === 'create_project') {
      const { title, client_name, deliverable_type, reference_type, reference_url, reference_text, brief_input } = body;
      if (!title || !brief_input) return errRes('title and brief_input are required', 400, id);

      const refCtx = reference_url ? `Reference material (${reference_type}): ${reference_url}\nNote: this engine cannot actually watch/fetch video content from this URL — use the URL and the founder's description together as context, and be explicit in the brief that a human should review the actual reference before final execution.` : reference_text ? `Reference notes: ${reference_text}` : 'No reference material given.';

      const brief = await callClaude(
        `You are the planning stage of an AI creative/product studio loop. Turn the founder's raw request into a clear, structured project brief: objective, target deliverable, key requirements, constraints, and success criteria. ${HONEST_LIMIT}`,
        `Client: ${client_name || 'internal'}\nDeliverable type: ${deliverable_type}\nFounder's request: ${brief_input}\n${refCtx}`
      );

      const { data: project, error } = await db.from('brain_projects').insert({
        title, client_name: client_name ?? null, deliverable_type: deliverable_type ?? 'other',
        reference_type: reference_type ?? 'none', reference_url: reference_url ?? null, reference_text: reference_text ?? null,
        brief, status: 'making', current_iteration: 0,
      }).select('id').single();
      if (error) throw error;

      return okRes({ project_id: project.id, brief, status: 'making', next_step: "Call action='run_iteration' to start the Maker/Critic loop." }, id);
    }

    if (body.action === 'run_iteration') {
      const { project_id } = body;
      if (!project_id) return errRes('project_id is required', 400, id);
      const { data: project, error: projErr } = await db.from('brain_projects').select('*').eq('id', project_id).single();
      if (projErr || !project) return errRes('Project not found', 404, id);
      if (!['making', 'reviewing'].includes(project.status)) return errRes(`Project is in status '${project.status}', not ready for another iteration`, 400, id);

      const { data: priorIterations } = await db.from('brain_project_iterations').select('*').eq('project_id', project_id).order('iteration_number', { ascending: true });
      const iterNum = (priorIterations?.length ?? 0) + 1;
      const lastCritic = priorIterations && priorIterations.length > 0 ? priorIterations[priorIterations.length - 1].critic_feedback : null;

      const makerOutput = await callClaude(
        `You are the Maker AI in an iterative studio loop, producing deliverable #${iterNum} for this brief. ${HONEST_LIMIT} Produce the full, real deliverable content — not a description of what you would make.`,
        `Brief: ${project.brief}\n${lastCritic ? `Previous Critic feedback to address: ${lastCritic}` : 'This is the first draft.'}`
      );

      const criticResult = await callClaude(
        `You are the Critic AI reviewing the Maker's output against the original brief. Be genuinely critical — real gaps, not rubber-stamp praise. Respond with ONLY valid JSON: {"approved": boolean, "feedback": string (specific, actionable rectifications if not approved; brief praise + why if approved)}`,
        `Brief: ${project.brief}\n\nMaker's output:\n${makerOutput}`
      );
      let approved = false; let feedback = criticResult;
      try { const parsed = JSON.parse(criticResult.replace(/^```json\s*/i, '').replace(/```\s*$/i, '')); approved = !!parsed.approved; feedback = parsed.feedback; } catch { /* keep raw text as feedback */ }

      await db.from('brain_project_iterations').insert({ project_id, iteration_number: iterNum, maker_output: makerOutput, critic_feedback: feedback, critic_approved: approved });

      const hitMax = iterNum >= (project.max_iterations ?? 4);
      const newStatus = approved || hitMax ? 'chief_review' : 'reviewing';
      await db.from('brain_projects').update({ status: newStatus, current_iteration: iterNum, updated_at: new Date().toISOString(), final_output: approved || hitMax ? makerOutput : null }).eq('id', project_id);

      if (newStatus === 'chief_review') {
        const chiefSummary = await callClaude(
          `You are the Chief of Staff giving the founder a final, honest summary before they review this. State plainly whether the Critic approved it or it just hit the iteration limit unresolved — never present a maxed-out, unapproved draft as if it succeeded.`,
          `Brief: ${project.brief}\nFinal iteration: ${iterNum}\nCritic approved: ${approved}\nFinal output:\n${makerOutput}`
        );
        await db.from('brain_projects').update({ chief_summary: chiefSummary, status: 'founder_review' }).eq('id', project_id);
        await db.from('founder_notifications').insert({ type: 'brain_project', title: `Ready for your review: ${project.title}`, detail: chiefSummary.slice(0, 300), department_code: 'EXECUTIVE', related_id: project_id });
        return okRes({ project_id, iteration: iterNum, status: 'founder_review', critic_approved: approved, hit_max_iterations: hitMax, maker_output: makerOutput, critic_feedback: feedback, chief_summary: chiefSummary }, id);
      }

      return okRes({ project_id, iteration: iterNum, status: newStatus, critic_approved: approved, maker_output: makerOutput, critic_feedback: feedback, next_step: 'Call run_iteration again to address the Critic feedback.' }, id);
    }

    if (body.action === 'founder_decide') {
      const { project_id, decision, founder_notes } = body;
      if (!project_id || !decision) return errRes('project_id and decision are required', 400, id);
      if (!['approved', 'rejected', 'needs_changes'].includes(decision)) return errRes("decision must be approved, rejected, or needs_changes", 400, id);
      const newStatus = decision === 'needs_changes' ? 'making' : decision;
      await db.from('brain_projects').update({ founder_decision: decision, founder_notes: founder_notes ?? null, status: newStatus, updated_at: new Date().toISOString() }).eq('id', project_id);
      return okRes({ project_id, status: newStatus }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return errRes(msg, 500, id);
  }
});
