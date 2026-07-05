import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
function ok(data: unknown) { return new Response(JSON.stringify(data), { status: 200, headers: CORS }); }
function err(msg: string, status = 500) { return new Response(JSON.stringify({ error: msg }), { status, headers: CORS }); }

const MODEL = 'claude-sonnet-4-6';
const PASS_SCORE = 80;
const MAX_ATTEMPTS = 2;

async function claude(apiKey: string, system: string, user: string, maxTokens: number) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json() as any;
  return data.content?.[0]?.text ?? '';
}

function parseJson(raw: string): any {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : raw.trim();
  const start = s.indexOf('{'); const arrStart = s.indexOf('[');
  const first = (arrStart >= 0 && (arrStart < start || start < 0)) ? arrStart : start;
  return JSON.parse(first > 0 ? s.slice(first) : s);
}

const PERSONAS: Record<string, string> = {
  frontend: 'You are a Senior Frontend Developer. You produce complete, production-quality HTML/CSS/JS or React code. No placeholders, no TODOs. All content fully visible without JavaScript. No iframes or external embeds.',
  backend: 'You are a Senior Backend Developer. You produce complete API designs and server code (Supabase edge functions / SQL). Include auth checks and error handling. No placeholders.',
  database: 'You are a Senior Database Architect. You produce complete PostgreSQL/Supabase migrations with RLS policies and indexes. Idempotent SQL only.',
  content: 'You are a Senior Content Strategist. You produce complete, polished business copy. Never invent statistics or financial figures — write [To be confirmed] for unknown data.',
  design: 'You are a Senior UI/UX Designer. You produce complete design specifications: color palettes, typography, layout structure, component descriptions.',
  qa: 'You are a Senior QA Engineer. You produce complete test plans and identify concrete defects with severity ratings.',
  security: 'You are a Senior Security Engineer. You review for vulnerabilities and produce concrete hardening recommendations.',
  general: 'You are a Senior Specialist. You produce complete, high-quality deliverables with no placeholders.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!supabaseUrl || !supabaseAnon) return err('Missing Supabase env');
    if (!anthropicKey) return err('Missing ANTHROPIC_API_KEY secret');

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
    const parts = authHeader.slice(7).split('.');
    if (parts.length !== 3) return err('Invalid JWT', 401);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Date.now() / 1000) return err('JWT expired', 401);
    const userId = payload.sub as string;

    const db = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
    const body = await req.json() as any;
    const { action } = body;
    console.log('ACTION', action, JSON.stringify(body).slice(0, 150));

    // ── list ──
    if (action === 'list') {
      const { data, error } = await db.from('orchestration_projects')
        .select('id, request, status, created_at').order('created_at', { ascending: false }).limit(15);
      if (error) return err(error.message);
      return ok({ projects: data ?? [] });
    }

    // ── status ──
    if (action === 'status') {
      const { data: project, error: pErr } = await db.from('orchestration_projects').select('*').eq('id', body.project_id).single();
      if (pErr) return err(pErr.message);
      const { data: tasks } = await db.from('orchestration_tasks').select('*').eq('project_id', body.project_id).order('created_at');
      return ok({ project, tasks: tasks ?? [] });
    }

    // ── start: CEO decomposition ──
    if (action === 'start') {
      if (!body.request?.trim()) return err('request is required', 400);
      const { data: project, error: insErr } = await db.from('orchestration_projects')
        .insert({ request: body.request, status: 'planning', created_by: userId }).select('id').single();
      if (insErr) return err(`Insert failed: ${insErr.message}`);
      console.log('PROJECT CREATED', project.id);

      const ceoSystem = 'You are the CEO AI of an autonomous software company. Decompose the client request into 3-5 specialist tasks. Return ONLY a JSON object: {"output_type":"html"|"document","tasks":[{"role":"frontend"|"backend"|"database"|"content"|"design"|"qa"|"security"|"general","title":"short title","description":"detailed instructions for the specialist, self-contained, they cannot see the other tasks"}]}. Choose output_type "html" if the final deliverable is a website/page, otherwise "document". Order tasks logically (design/content before frontend). Keep it to the MINIMUM tasks genuinely needed.';
      const raw = await claude(anthropicKey, ceoSystem, `Client request: ${body.request}`, 2000);
      let plan: any;
      try { plan = parseJson(raw); } catch {
        await db.from('orchestration_projects').update({ status: 'failed', error_message: 'CEO decomposition returned invalid JSON' }).eq('id', project.id);
        return err('CEO decomposition failed to parse');
      }
      const tasks = (plan.tasks ?? []).slice(0, 5).map((t: any) => ({
        project_id: project.id,
        role: PERSONAS[t.role] ? t.role : 'general',
        title: String(t.title ?? 'Task').slice(0, 200),
        description: String(t.description ?? '').slice(0, 4000),
      }));
      if (tasks.length === 0) {
        await db.from('orchestration_projects').update({ status: 'failed', error_message: 'CEO produced no tasks' }).eq('id', project.id);
        return err('CEO produced no tasks');
      }
      const { error: tErr } = await db.from('orchestration_tasks').insert(tasks);
      if (tErr) return err(`Task insert failed: ${tErr.message}`);
      await db.from('orchestration_projects').update({ status: 'working', output_type: plan.output_type === 'html' ? 'html' : 'document' }).eq('id', project.id);
      console.log('CEO PLAN', { taskCount: tasks.length, outputType: plan.output_type });
      return ok({ project_id: project.id, status: 'working', tasks_created: tasks.length });
    }

    // ── advance: one step of the pipeline ──
    if (action === 'advance') {
      const projectId = body.project_id;
      if (!projectId) return err('project_id required', 400);
      const { data: project, error: pErr } = await db.from('orchestration_projects').select('*').eq('id', projectId).single();
      if (pErr) return err(pErr.message);
      if (project.status === 'complete' || project.status === 'failed') return ok({ status: project.status, done: true });

      const { data: tasks } = await db.from('orchestration_tasks').select('*').eq('project_id', projectId).order('created_at');
      const all = tasks ?? [];

      // 1. WORKING: execute one pending task
      const pending = all.find(t => t.status === 'pending');
      if (project.status === 'working' && pending) {
        console.log('EXECUTING TASK', pending.title);
        const persona = PERSONAS[pending.role] ?? PERSONAS.general;
        const output = await claude(anthropicKey, persona,
          `Overall project: ${project.request}\n\nYour task: ${pending.title}\n\n${pending.description}\n\nProduce the complete deliverable now.`, 16000);
        await db.from('orchestration_tasks').update({ output, status: 'done', attempts: pending.attempts + 1 }).eq('id', pending.id);
        const remaining = all.filter(t => t.status === 'pending' && t.id !== pending.id).length;
        if (remaining === 0) await db.from('orchestration_projects').update({ status: 'reviewing' }).eq('id', projectId);
        return ok({ status: remaining === 0 ? 'reviewing' : 'working', step: `Completed: ${pending.title}`, done: false });
      }

      // 2. REVIEWING: manager scores all done tasks (one call)
      if (project.status === 'reviewing') {
        const toReview = all.filter(t => t.status === 'done');
        if (toReview.length > 0) {
          console.log('REVIEWING', toReview.length, 'tasks');
          const reviewSystem = 'You are a strict Engineering Manager AI. Score each deliverable 0-100 for completeness, quality, and absence of placeholders/TODOs/invented statistics. Return ONLY JSON: {"reviews":[{"id":"task id","score":85,"notes":"specific issues or approval note"}]}';
          const reviewInput = toReview.map(t => `TASK ID: ${t.id}\nTITLE: ${t.title}\nDELIVERABLE:\n${(t.output ?? '').slice(0, 6000)}`).join('\n\n====\n\n');
          const raw = await claude(anthropicKey, reviewSystem, `Project: ${project.request}\n\n${reviewInput}`, 2000);
          let reviews: any;
          try { reviews = parseJson(raw).reviews ?? []; } catch { reviews = toReview.map(t => ({ id: t.id, score: PASS_SCORE, notes: 'Review parse failed — auto-passed' })); }
          let anyRework = false;
          for (const r of reviews) {
            const task = toReview.find(t => t.id === r.id);
            if (!task) continue;
            const score = Math.max(0, Math.min(100, Number(r.score) || 0));
            const needsRework = score < PASS_SCORE && task.attempts < MAX_ATTEMPTS;
            if (needsRework) anyRework = true;
            await db.from('orchestration_tasks').update({
              review_score: score, review_notes: String(r.notes ?? '').slice(0, 1000),
              status: needsRework ? 'rework' : 'approved',
            }).eq('id', task.id);
          }
          await db.from('orchestration_projects').update({ status: anyRework ? 'reworking' : 'merging' }).eq('id', projectId);
          return ok({ status: anyRework ? 'reworking' : 'merging', step: `Manager reviewed ${toReview.length} tasks`, done: false });
        }
        await db.from('orchestration_projects').update({ status: 'merging' }).eq('id', projectId);
        return ok({ status: 'merging', step: 'Nothing to review', done: false });
      }

      // 3. REWORKING: fix one rework task
      const reworkTask = all.find(t => t.status === 'rework');
      if (project.status === 'reworking' && reworkTask) {
        console.log('REWORKING', reworkTask.title);
        const persona = PERSONAS[reworkTask.role] ?? PERSONAS.general;
        const output = await claude(anthropicKey, persona,
          `Overall project: ${project.request}\n\nYour task: ${reworkTask.title}\n${reworkTask.description}\n\nYour previous attempt was REJECTED by the manager with these notes:\n${reworkTask.review_notes}\n\nPrevious attempt:\n${(reworkTask.output ?? '').slice(0, 6000)}\n\nProduce a corrected, complete deliverable now.`, 16000);
        await db.from('orchestration_tasks').update({ output, status: 'approved', attempts: reworkTask.attempts + 1, review_notes: (reworkTask.review_notes ?? '') + ' [Reworked]' }).eq('id', reworkTask.id);
        const remainingRework = all.filter(t => t.status === 'rework' && t.id !== reworkTask.id).length;
        if (remainingRework === 0) await db.from('orchestration_projects').update({ status: 'merging' }).eq('id', projectId);
        return ok({ status: remainingRework === 0 ? 'merging' : 'reworking', step: `Reworked: ${reworkTask.title}`, done: false });
      }

      // 4. MERGING: CPO compiles final deliverable
      if (project.status === 'merging' || project.status === 'reworking') {
        console.log('MERGING');
        const approved = all.filter(t => t.status === 'approved' || t.status === 'done');
        const isHtml = project.output_type === 'html';
        const cpoSystem = isHtml
          ? 'You are the Chief Project Officer AI. Merge the specialist deliverables into ONE complete, final, self-contained HTML file starting with <!DOCTYPE html>. No markdown fences, no explanation. All CSS in <style>, all JS in <script>. No iframes, no external embeds, no opacity-0 animations — content fully visible without JS. Incorporate the content, design, and code from the deliverables faithfully. Never invent financial figures — keep [To be confirmed] markers as-is.'
          : 'You are the Chief Project Officer AI. Merge the specialist deliverables into ONE complete, final, well-structured document (markdown). Incorporate everything faithfully, resolve overlaps, no placeholders. Never invent financial figures.';
        const mergeInput = approved.map(t => `## ${t.title} (${t.role}, score ${t.review_score ?? 'n/a'})\n${(t.output ?? '').slice(0, 24000)}`).join('\n\n');
        let final = await claude(anthropicKey, cpoSystem, `Project: ${project.request}\n\nSpecialist deliverables:\n\n${mergeInput}\n\nProduce the final merged deliverable now.`, 24000);
        if (isHtml) {
          const docIdx = final.indexOf('<!DOCTYPE'); const htmlIdx = final.indexOf('<html');
          const start = docIdx >= 0 ? docIdx : htmlIdx;
          if (start > 0) final = final.slice(start);
          const endIdx = final.lastIndexOf('</html>');
          if (endIdx >= 0) final = final.slice(0, endIdx + 7);
          final = final.replace(/opacity:\s*0(?![.\d])/g, 'opacity: 1');
        }
        await db.from('orchestration_projects').update({ status: 'complete', final_output: final }).eq('id', projectId);
        return ok({ status: 'complete', step: 'CPO merged final deliverable', done: true });
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
