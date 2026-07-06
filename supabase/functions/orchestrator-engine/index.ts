// ============================================================
// orchestrator-engine v13 — AI Company pipeline (CEO → specialists → manager → CPO)
//
// v11's in-call continuation (looping the SAME edge-function invocation up to
// 4x on truncation) caused a NEW failure: verified live, two consecutive
// 'advance' calls each hit the 55s test timeout and the underlying edge
// function never wrote anything to the DB — a single 8000-token call already
// took 90-150s in earlier verified runs, so doubling it via continuation
// blew past the platform's execution window entirely. Net effect: pipeline
// hangs with zero progress, worse than the plain-truncation bug it fixed.
//
// v13 fix: continuation now happens ACROSS 'advance' calls, not within one.
// Each invocation makes exactly ONE Claude call (the latency profile already
// proven safe). If that call is truncated, the partial text is saved to a
// new `draft_output` column and the task STAYS in its current status so the
// next 'advance' call (the frontend already polls in a loop) picks it back
// up, sends the draft as continuation context, and appends the next chunk.
// Same pattern applied to the CPO merge step via `draft_final_output`.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-heartbeat-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const GEMINI_MODEL = 'gemini-2.5-flash';
const RATES: Record<string, { inp: number; out: number }> = {
  [ANTHROPIC_MODEL]: { inp: 270, out: 1350 },
  [GEMINI_MODEL]: { inp: 27, out: 220 },
};
const PASS_SCORE = 70;
const MAX_ATTEMPTS = 2;
const MAX_CONTINUATIONS = 4; // hard ceiling per task/merge across calls, avoids infinite loop

const PERSONAS: Record<string, string> = {
  frontend: 'You are an award-winning frontend designer-developer, not a template generator. You produce complete, production-quality HTML/CSS/JS or React code. DESIGN DIRECTION: pick a genuine typographic identity (import 2 real Google Fonts, one display one body, and actually vary weight/tracking with intent — never default to system-ui-only stacks); commit to a real color identity grounded in the brand given, not a reflexive blue-to-purple gradient; break the "centered hero, 3-column grid, centered CTA" template with at least one asymmetric or full-bleed section; add real hover/scroll micro-interactions, not decoration; vary section rhythm instead of repeating padded card grids; write specific copy grounded in the actual brand, never generic filler. No placeholders, no TODOs. All content fully visible without JavaScript. No iframes or external embeds.',
  backend: 'You are a Senior Backend Developer. You produce complete API designs and server code (Supabase edge functions / SQL). Include auth checks and error handling. No placeholders.',
  database: 'You are a Senior Database Architect. You produce complete PostgreSQL/Supabase migrations with RLS policies and indexes. Idempotent SQL only.',
  content: 'You are a Senior Content Strategist. You produce complete, polished business copy. Never invent statistics or financial figures — write [To be confirmed] for unknown data.',
  design: 'You are a Senior UI/UX Designer. You produce complete design specifications: color palettes, typography, layout structure, component descriptions.',
  qa: 'You are a Senior QA Engineer. You produce complete test plans and identify concrete defects with severity ratings.',
  general: 'You are a Senior Specialist. You produce complete, high-quality deliverables with no placeholders.',
};

interface LLMResult { text: string; inputTokens: number; outputTokens: number; model: string; fellBack: boolean; truncated: boolean; }

async function callAnthropic(key: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`); }
  const d = await res.json() as any;
  return { text: d.content?.[0]?.text ?? '', inputTokens: d.usage?.input_tokens ?? 0, outputTokens: d.usage?.output_tokens ?? 0, model: ANTHROPIC_MODEL, fellBack: false, truncated: d.stop_reason === 'max_tokens' };
}

async function callGemini(key: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens + 256, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`); }
  const d = await res.json() as any;
  const text = (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  return { text, inputTokens: d.usageMetadata?.promptTokenCount ?? 0, outputTokens: d.usageMetadata?.candidatesTokenCount ?? 0, model: GEMINI_MODEL, fellBack: false, truncated: d.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
}

function makeLLM(anthropicKey: string | undefined, geminiKey: string | undefined) {
  return async (system: string, user: string, maxTokens: number): Promise<LLMResult> => {
    if (!anthropicKey && !geminiKey) throw new Error('Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set');
    if (!anthropicKey) { const r = await callGemini(geminiKey!, system, user, maxTokens); return { ...r, fellBack: true }; }
    try {
      return await callAnthropic(anthropicKey, system, user, maxTokens);
    } catch (pe) {
      const pMsg = pe instanceof Error ? pe.message : String(pe);
      console.log('LLM FALLBACK to Gemini —', pMsg.slice(0, 200));
      if (!geminiKey) throw pe;
      try { const r = await callGemini(geminiKey, system, user, maxTokens); return { ...r, fellBack: true }; }
      catch (fe) { throw new Error(`Both providers failed. Primary: ${pMsg.slice(0, 200)} | Fallback: ${fe instanceof Error ? fe.message : String(fe)}`.slice(0, 450)); }
    }
  };
}

const costInr = (m: string, i: number, o: number) => { const r = RATES[m] ?? RATES[ANTHROPIC_MODEL]; return (i / 1e6) * r.inp + (o / 1e6) * r.out; };

function parseJson(raw: string): any {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : raw.trim();
  const start = s.indexOf('{');
  return JSON.parse(start > 0 ? s.slice(start) : s);
}

// Builds the continuation-aware user prompt: fresh instructions on the first
// call, or "continue from here" using the accumulated draft on later calls.
function buildPrompt(baseInstruction: string, draft: string | null): string {
  if (!draft) return baseInstruction;
  return `${baseInstruction}\n\n[Your output was cut off. Here is everything you have written so far — continue EXACTLY from the end, no repetition, no commentary, output only the remainder:]\n${draft.slice(-4000)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!supabaseUrl || !supabaseAnon) return err('Missing Supabase env');
    if (!anthropicKey && !geminiKey) return err('Missing both ANTHROPIC_API_KEY and GEMINI_API_KEY');
    const callLLM = makeLLM(anthropicKey, geminiKey);

    // Auth: service path (heartbeat secret) OR browser path (user JWT + RLS)
    const hbSecret = Deno.env.get('HEARTBEAT_SECRET');
    const providedSecret = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    let db: any;
    if (hbSecret && providedSecret === hbSecret && serviceKey) {
      db = createClient(supabaseUrl, serviceKey);
    } else {
      const authHeader = req.headers.get('Authorization') ?? '';
      if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
      const parts = authHeader.slice(7).split('.');
      if (parts.length !== 3) return err('Invalid JWT', 401);
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.exp && payload.exp < Date.now() / 1000) return err('JWT expired', 401);
      db = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
    }

    const body = await req.json() as any;
    const { action } = body;
    console.log('ACTION', action, JSON.stringify(body).slice(0, 150));

    async function logStep(step: string, status: string, inSummary: string, outSummary: string, r?: LLMResult, latencyMs?: number) {
      try {
        await db.from('execution_log').insert({
          function_name: 'orchestrator-engine', department_code: 'RND', action: step, status,
          input_summary: inSummary.slice(0, 500), output_summary: outSummary.slice(0, 500),
          model: r?.model ?? null, input_tokens: r?.inputTokens ?? null, output_tokens: r?.outputTokens ?? null,
          cost_estimate_inr: r ? costInr(r.model, r.inputTokens, r.outputTokens) : null,
          latency_ms: latencyMs ?? null,
        });
      } catch (_) {}
    }

    if (action === 'list') {
      const { data, error } = await db.from('orchestration_projects')
        .select('id, request, status, output_type, created_at, final_output')
        .order('created_at', { ascending: false }).limit(20);
      if (error) return err(error.message);
      return ok({ projects: (data ?? []).map((p: any) => ({ ...p, has_final: !!p.final_output, final_output: undefined })) });
    }

    if (action === 'status') {
      const { data: project, error: pErr } = await db.from('orchestration_projects').select('*').eq('id', body.project_id).single();
      if (pErr) return err(pErr.message);
      const { data: tasks } = await db.from('orchestration_tasks').select('*').eq('project_id', body.project_id).order('created_at');
      return ok({ project, tasks: tasks ?? [] });
    }

    if (action === 'start') {
      if (!body.request?.trim()) return err('request is required', 400);
      const wantsHtml = /website|landing|page|html|site/i.test(body.request);
      const ceoSystem = `You are the CEO AI of an autonomous software company. Decompose the client request into 2-5 specialist tasks. Roles available: ${Object.keys(PERSONAS).filter(r => r !== 'general').join(', ')}. Return ONLY JSON: {"output_type": "${wantsHtml ? 'html' : 'document'}", "tasks": [{"role": "frontend", "title": "short title", "description": "precise instructions for this specialist"}]}`;
      const t0 = Date.now();
      const r = await callLLM(ceoSystem, `Client request: ${body.request}`, 2000);
      let plan: any;
      try { plan = parseJson(r.text); } catch { await logStep('ceo_decompose', 'failure', body.request, r.text, r, Date.now() - t0); return err('CEO planning failed to parse'); }
      const { data: proj, error: pErr } = await db.from('orchestration_projects').insert({
        request: body.request.trim(), status: 'working', output_type: plan.output_type === 'html' ? 'html' : 'document',
      }).select('id').single();
      if (pErr) return err(`DB insert failed: ${pErr.message}`);
      const tasks = (plan.tasks ?? []).slice(0, 5).map((t: any) => ({
        project_id: proj.id, role: PERSONAS[t.role] ? t.role : 'general',
        title: String(t.title ?? 'Task').slice(0, 200), description: String(t.description ?? '').slice(0, 2000), status: 'pending', attempts: 0,
      }));
      if (tasks.length === 0) return err('CEO produced no tasks');
      const { error: tErr } = await db.from('orchestration_tasks').insert(tasks);
      if (tErr) return err(`Task insert failed: ${tErr.message}`);
      await logStep('ceo_decompose', r.fellBack ? 'success_fallback' : 'success', body.request, `${tasks.length} tasks`, r, Date.now() - t0);
      return ok({ project_id: proj.id, tasks_created: tasks.length, model: r.model });
    }

    if (action === 'advance') {
      const projectId = body.project_id;
      if (!projectId) return err('project_id required', 400);
      const { data: project, error: pErr } = await db.from('orchestration_projects').select('*').eq('id', projectId).single();
      if (pErr) return err(pErr.message);
      if (project.status === 'complete' || project.status === 'failed') return ok({ status: project.status, done: true });

      const { data: tasks } = await db.from('orchestration_tasks').select('*').eq('project_id', projectId).order('created_at');
      const all = tasks ?? [];

      // 1. WORKING: execute (or continue) one pending task — ONE Claude call
      // per advance, matching the latency profile already proven safe.
      const pending = all.find((t: any) => t.status === 'pending');
      if (project.status === 'working' && pending) {
        const t0 = Date.now();
        const persona = PERSONAS[pending.role] ?? PERSONAS.general;
        const baseInstruction = `Overall project: ${project.request}\n\nYour task: ${pending.title}\n\n${pending.description}\n\nProduce the complete deliverable now. Be thorough but efficient — quality over length.`;
        const draft: string | null = pending.draft_output ?? null;
        const r = await callLLM(persona, buildPrompt(baseInstruction, draft), 8000);
        const combined = (draft ?? '') + r.text;
        const priorContinuations = pending.attempts ?? 0;

        if (r.truncated && priorContinuations < MAX_CONTINUATIONS) {
          // Save progress, stay 'pending' so the NEXT advance call continues it.
          await db.from('orchestration_tasks').update({ draft_output: combined, attempts: priorContinuations + 1 }).eq('id', pending.id);
          await logStep('specialist_execute', 'continuing', pending.title, `truncated, ${combined.length} chars so far`, r, Date.now() - t0);
          return ok({ status: 'working', step: `Still writing: ${pending.title} (${priorContinuations + 1}/${MAX_CONTINUATIONS})…`, done: false, model: r.model });
        }

        await db.from('orchestration_tasks').update({ output: combined, draft_output: null, status: 'done', attempts: priorContinuations + 1 }).eq('id', pending.id);
        const remaining = all.filter((t: any) => t.status === 'pending' && t.id !== pending.id).length;
        if (remaining === 0) await db.from('orchestration_projects').update({ status: 'reviewing' }).eq('id', projectId);
        await logStep('specialist_execute', r.fellBack ? 'success_fallback' : 'success', pending.title, combined.slice(0, 200), r, Date.now() - t0);
        return ok({ status: remaining === 0 ? 'reviewing' : 'working', step: `Completed: ${pending.title}${r.fellBack ? ' (via Gemini fallback)' : ''}`, done: false, model: r.model });
      }

      // 2. REVIEWING: manager scores all done tasks (one call)
      if (project.status === 'reviewing') {
        const toReview = all.filter((t: any) => t.status === 'done');
        if (toReview.length > 0) {
          const t0 = Date.now();
          const reviewSystem = 'You are a strict Engineering Manager AI. Score each deliverable 0-100 for completeness, quality, and absence of placeholders/TODOs/invented statistics. Return ONLY JSON: {"reviews":[{"id":"task id","score":85,"notes":"specific issues or approval note"}]}';
          const reviewInput = toReview.map((t: any) => `TASK ID: ${t.id}\nTITLE: ${t.title}\nDELIVERABLE:\n${(t.output ?? '').slice(0, 6000)}`).join('\n\n====\n\n');
          const r = await callLLM(reviewSystem, `Project: ${project.request}\n\n${reviewInput}`, 2000);
          let reviews: any;
          try { reviews = parseJson(r.text).reviews ?? []; } catch { reviews = toReview.map((t: any) => ({ id: t.id, score: PASS_SCORE, notes: 'Review parse failed — auto-passed' })); }
          let anyRework = false;
          for (const rv of reviews) {
            const task = toReview.find((t: any) => t.id === rv.id);
            if (!task) continue;
            const score = Math.max(0, Math.min(100, Number(rv.score) || 0));
            const needsRework = score < PASS_SCORE && task.attempts < MAX_ATTEMPTS + MAX_CONTINUATIONS;
            if (needsRework) anyRework = true;
            await db.from('orchestration_tasks').update({
              review_score: score, review_notes: String(rv.notes ?? '').slice(0, 1000),
              status: needsRework ? 'rework' : 'approved',
            }).eq('id', task.id);
          }
          await db.from('orchestration_projects').update({ status: anyRework ? 'reworking' : 'merging' }).eq('id', projectId);
          await logStep('manager_review', r.fellBack ? 'success_fallback' : 'success', `${toReview.length} tasks`, JSON.stringify(reviews).slice(0, 200), r, Date.now() - t0);
          return ok({ status: anyRework ? 'reworking' : 'merging', step: `Manager reviewed ${toReview.length} tasks`, done: false, model: r.model });
        }
        await db.from('orchestration_projects').update({ status: 'merging' }).eq('id', projectId);
        return ok({ status: 'merging', step: 'Nothing to review', done: false });
      }

      // 3. REWORKING: fix (or continue fixing) one rework task
      const reworkTask = all.find((t: any) => t.status === 'rework');
      if (project.status === 'reworking' && reworkTask) {
        const t0 = Date.now();
        const persona = PERSONAS[reworkTask.role] ?? PERSONAS.general;
        // draft_output here means "in-progress corrected attempt"; output still
        // holds the REJECTED prior version used as context below.
        const isContinuingFix = !!reworkTask.draft_output;
        const baseInstruction = `Overall project: ${project.request}\n\nYour task: ${reworkTask.title}\n${reworkTask.description}\n\nYour previous attempt was REJECTED by the manager with these notes:\n${reworkTask.review_notes}\n\nPrevious attempt:\n${(reworkTask.output ?? '').slice(0, 6000)}\n\nProduce a corrected, complete deliverable now.`;
        const r = await callLLM(persona, buildPrompt(baseInstruction, isContinuingFix ? reworkTask.draft_output : null), 8000);
        const combined = (isContinuingFix ? reworkTask.draft_output : '') + r.text;
        const priorContinuations = isContinuingFix ? (reworkTask.attempts ?? 0) : 0;

        if (r.truncated && priorContinuations < MAX_CONTINUATIONS) {
          await db.from('orchestration_tasks').update({ draft_output: combined, attempts: (reworkTask.attempts ?? 0) + 1 }).eq('id', reworkTask.id);
          await logStep('specialist_rework', 'continuing', reworkTask.title, `truncated, ${combined.length} chars so far`, r, Date.now() - t0);
          return ok({ status: 'reworking', step: `Still fixing: ${reworkTask.title}…`, done: false, model: r.model });
        }

        await db.from('orchestration_tasks').update({ output: combined, draft_output: null, status: 'approved', attempts: (reworkTask.attempts ?? 0) + 1, review_notes: (reworkTask.review_notes ?? '') + ' [Reworked]' }).eq('id', reworkTask.id);
        const remainingRework = all.filter((t: any) => t.status === 'rework' && t.id !== reworkTask.id).length;
        if (remainingRework === 0) await db.from('orchestration_projects').update({ status: 'merging' }).eq('id', projectId);
        await logStep('specialist_rework', r.fellBack ? 'success_fallback' : 'success', reworkTask.title, combined.slice(0, 200), r, Date.now() - t0);
        return ok({ status: remainingRework === 0 ? 'merging' : 'reworking', step: `Reworked: ${reworkTask.title}`, done: false, model: r.model });
      }

      // 4. MERGING: CPO compiles (or continues compiling) the final deliverable.
      // Same cross-call continuation pattern via draft_final_output — this is
      // the step that was producing BLANK previews (final_output ending
      // mid-<style>, no closing </html>, so the iframe had nothing to render).
      if (project.status === 'merging' || project.status === 'reworking') {
        const t0 = Date.now();
        const approved = all.filter((t: any) => t.status === 'approved' || t.status === 'done');
        const isHtml = project.output_type === 'html';
        const frontendTask = approved.find((t: any) => t.role === 'frontend');
        const isContinuingMerge = !!project.draft_final_output;

        let baseInstruction: string;
        let cpoSystem: string;
        if (isHtml && frontendTask?.output && /<html|<!DOCTYPE/i.test(frontendTask.output)) {
          const others = approved.filter((t: any) => t.id !== frontendTask.id);
          cpoSystem = 'You are the Chief Project Officer AI, also an experienced design director. You are given a BASE HTML file produced by the frontend specialist, plus supporting deliverables (content, design notes, QA findings). EDIT the base HTML: apply the copy from the content deliverable, honor the design specification, and fix every defect the QA deliverable identifies. PRESERVE AND SHARPEN the base file\\'s distinctive typography, color identity, and layout choices — do not flatten it toward a generic template while merging. Return ONLY the final complete HTML file starting with <!DOCTYPE html> — no markdown fences, no explanation. Keep it self-contained (CSS in <style>, JS in <script>), no iframes, no opacity-0 animations. Never invent financial figures — keep [To be confirmed] markers as-is.';
          const supportInput = others.map((t: any) => `## ${t.title} (${t.role})\n${(t.output ?? '').slice(0, 5000)}`).join('\n\n');
          baseInstruction = `Project: ${project.request}\n\nBASE HTML:\n${frontendTask.output.slice(0, 40000)}\n\nSUPPORTING DELIVERABLES:\n${supportInput}\n\nProduce the final HTML now.`;
        } else {
          cpoSystem = isHtml
            ? 'You are the Chief Project Officer AI. Merge the specialist deliverables into ONE complete, final, self-contained HTML file starting with <!DOCTYPE html>. No markdown fences, no explanation. All CSS in <style>, all JS in <script>. No iframes, no external embeds, no opacity-0 animations — content fully visible without JS. Never invent financial figures — keep [To be confirmed] markers as-is.'
            : 'You are the Chief Project Officer AI. Merge the specialist deliverables into ONE complete, final, well-structured document (markdown). Incorporate everything faithfully, resolve overlaps, no placeholders. Never invent financial figures.';
          const mergeInput = approved.map((t: any) => `## ${t.title} (${t.role}, score ${t.review_score ?? 'n/a'})\n${(t.output ?? '').slice(0, 12000)}`).join('\n\n');
          baseInstruction = `Project: ${project.request}\n\nSpecialist deliverables:\n\n${mergeInput}\n\nProduce the final merged deliverable now.`;
        }

        const r = await callLLM(cpoSystem, buildPrompt(baseInstruction, isContinuingMerge ? project.draft_final_output : null), 8000);
        const combined = (isContinuingMerge ? project.draft_final_output : '') + r.text;
        const priorContinuations = project.merge_continuations ?? 0;

        if (r.truncated && priorContinuations < MAX_CONTINUATIONS) {
          await db.from('orchestration_projects').update({ draft_final_output: combined, merge_continuations: priorContinuations + 1 }).eq('id', projectId);
          await logStep('cpo_merge', 'continuing', project.request, `truncated, ${combined.length} chars so far`, r, Date.now() - t0);
          return ok({ status: project.status, step: `CPO still merging (${priorContinuations + 1}/${MAX_CONTINUATIONS})…`, done: false, model: r.model });
        }

        let final = combined;
        if (isHtml) {
          const docIdx = final.indexOf('<!DOCTYPE'); const htmlIdx = final.indexOf('<html');
          const start = docIdx >= 0 ? docIdx : htmlIdx;
          if (start > 0) final = final.slice(start);
          const endIdx = final.lastIndexOf('</html>');
          if (endIdx >= 0) final = final.slice(0, endIdx + 7);
          final = final.replace(/opacity:\s*0(?![.\d])/g, 'opacity: 1');
          // Safety net: if still no closing tag after MAX_CONTINUATIONS, force one
          // rather than ship literally-broken markup that renders blank.
          if (!/<\/html>/i.test(final)) final += '\n</body>\n</html>';
        }
        await db.from('orchestration_projects').update({ status: 'complete', final_output: final, draft_final_output: null }).eq('id', projectId);
        await logStep('cpo_merge', r.fellBack ? 'success_fallback' : 'success', project.request, `final ${final.length} chars`, r, Date.now() - t0);
        return ok({ status: 'complete', step: 'CPO merged final deliverable', done: true, model: r.model });
      }

      return ok({ status: project.status, step: 'No action taken', done: false });
    }

    return err(`Unknown action: ${action}`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('UNCAUGHT', msg);
    return err(`Uncaught: ${msg}`);
  }
});
