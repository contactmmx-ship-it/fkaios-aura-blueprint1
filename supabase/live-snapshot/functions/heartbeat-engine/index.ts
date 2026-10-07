import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function ok(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: CORS }); }
function err(m: string, s = 500) { return new Response(JSON.stringify({ error: m }), { status: s, headers: CORS }); }

const MODEL = 'claude-sonnet-4-6';
const INR_PER_INPUT_MTOK = 270;   // ~$3/MTok input at ~90 INR/USD
const INR_PER_OUTPUT_MTOK = 1350; // ~$15/MTok output

async function claude(apiKey: string, system: string, user: string, maxTokens = 500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json() as any;
  return {
    text: data.content?.[0]?.text ?? '',
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

function costInr(inputTokens: number, outputTokens: number) {
  return (inputTokens / 1_000_000) * INR_PER_INPUT_MTOK + (outputTokens / 1_000_000) * INR_PER_OUTPUT_MTOK;
}

async function sendWhatsAppReply(accessToken: string, phoneNumberId: string, toPhone: string, text: string) {
  const toFormatted = toPhone.startsWith('91') ? toPhone : `91${toPhone}`;
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: toFormatted, type: 'text', text: { preview_url: false, body: text } }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`WhatsApp send failed: ${body?.error?.message ?? res.status}`);
  return body?.messages?.[0]?.id ?? null;
}

const VALID_STAGES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'closed', 'lost'];
const AI_ALLOWED_STAGES = ['contacted', 'qualified', 'lost'];

function extractJson(raw: string): any {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : raw.trim();
  const start = s.indexOf('{');
  return JSON.parse(start > 0 ? s.slice(start) : s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseSvc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const heartbeatSecret = Deno.env.get('HEARTBEAT_SECRET');
    const whatsappToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
    const whatsappPhoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
    if (!supabaseUrl || !supabaseAnon) return err('Missing Supabase env');
    if (!anthropicKey) return err('Missing ANTHROPIC_API_KEY');

    const providedSecret = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    if (heartbeatSecret && providedSecret !== heartbeatSecret) return err('Unauthorized', 401);

    const db = createClient(supabaseUrl, supabaseSvc || supabaseAnon);
    const nowIso = new Date().toISOString();

    // Unified observability (Prompt 24): every meaningful action writes here.
    async function logExec(entry: {
      action: string; status: 'success' | 'failure' | 'skipped' | 'pending_approval';
      input_summary?: string; output_summary?: string; error?: string;
      input_tokens?: number; output_tokens?: number; latency_ms?: number; department_code?: string;
    }) {
      try {
        await db.from('execution_log').insert({
          function_name: 'heartbeat-engine',
          department_code: entry.department_code ?? null,
          action: entry.action,
          input_summary: entry.input_summary?.slice(0, 500) ?? null,
          output_summary: entry.output_summary?.slice(0, 500) ?? null,
          status: entry.status,
          error: entry.error?.slice(0, 500) ?? null,
          model: entry.input_tokens ? MODEL : null,
          input_tokens: entry.input_tokens ?? null,
          output_tokens: entry.output_tokens ?? null,
          cost_estimate_inr: entry.input_tokens ? costInr(entry.input_tokens ?? 0, entry.output_tokens ?? 0) : null,
          latency_ms: entry.latency_ms ?? null,
        });
      } catch (_) { /* logging must never break execution */ }
    }

    const { data: dueTasks, error: dueErr } = await db.from('scheduled_tasks')
      .select('*').eq('is_active', true).lte('next_run_at', nowIso);
    if (dueErr) return err(`Failed to read scheduled_tasks: ${dueErr.message}`);

    const results: any[] = [];

    for (const task of dueTasks ?? []) {
      console.log('RUNNING TASK', task.task_key);
      let status = 'ok';
      let detail = '';
      const t0 = Date.now();
      try {
        if (task.action === 'chief_of_staff_briefing') {
          const { data: leads } = await db.from('leads').select('id, contact_name, stage, created_at').order('created_at', { ascending: false }).limit(20);
          const { data: brands } = await db.from('brands').select('name').eq('is_active', true);
          const { data: pendingApprovals } = await db.from('approvals').select('action_type, amount_inr, reason').eq('status', 'pending').limit(10);
          const r = await claude(anthropicKey,
            'You are the Chief of Staff AI. Produce a concise daily briefing (under 300 words) for the founder based on real data given. Never invent numbers not present in the data. If there are pending approvals, list them first — the founder must act on them.',
            `Recent leads (${leads?.length ?? 0} total, showing up to 20): ${JSON.stringify(leads ?? [])}\nActive brands: ${JSON.stringify(brands ?? [])}\nPending approvals awaiting the founder: ${JSON.stringify(pendingApprovals ?? [])}\n\nWrite today's briefing.`, 1000);
          await db.from('system_events').insert({ event_type: 'daily_briefing_generated', payload: { briefing: r.text }, processed: true, processed_at: nowIso });
          await logExec({ action: 'chief_of_staff_briefing', status: 'success', department_code: 'EXECUTIVE', output_summary: r.text.slice(0, 300), input_tokens: r.inputTokens, output_tokens: r.outputTokens, latency_ms: Date.now() - t0 });
          detail = `Briefing generated (${r.text.length} chars)`;
        }

        else if (task.action === 'check_leads') {
          const { data: unreplied } = await db.from('whatsapp_inbound_messages')
            .select('id, lead_id, phone, message_text, created_at')
            .eq('replied', false).order('created_at', { ascending: true }).limit(10);

          let repliesSent = 0;
          let replySkippedReason = '';

          for (const msg of unreplied ?? []) {
            if (!whatsappToken || !whatsappPhoneId) {
              replySkippedReason = 'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured';
              break;
            }

            // CIRCUIT BREAKER: if this message already failed 3+ times with an auth
            // error, stop burning Claude tokens on drafts that can never be sent.
            // Resumes automatically once the token is fixed and failures stop matching.
            const { count: authFails } = await db.from('system_events')
              .select('id', { count: 'exact', head: true })
              .eq('event_type', 'ai_reply_failed')
              .filter('payload->>message_id', 'eq', String(msg.id))
              .ilike('payload->>error', '%Authentication%');
            if ((authFails ?? 0) >= 3) {
              replySkippedReason = 'WhatsApp token expired — awaiting permanent System User token (circuit breaker active, not retrying)';
              await logExec({ action: 'whatsapp_reply', status: 'skipped', department_code: 'SALES', input_summary: `msg ${msg.id} from ${msg.phone}`, error: replySkippedReason });
              continue;
            }

            try {
              const { data: brands } = await db.from('brands').select('name, sector, investment_range, royalty').eq('is_active', true);
              const brandsCtx = (brands && brands.length > 0)
                ? brands.map((b: any) => `${b.name} (${b.sector}, ${b.investment_range || 'investment range not set'}, royalty ${b.royalty || 'not set'})`).join('; ')
                : 'No active brands configured yet';

              const { data: history } = await db.from('whatsapp_inbound_messages')
                .select('message_text, reply_text, created_at').eq('lead_id', msg.lead_id)
                .order('created_at', { ascending: true }).limit(10);
              const convo = (history ?? []).map((h: any) => `Prospect: ${h.message_text}${h.reply_text ? `\nYou replied: ${h.reply_text}` : ''}`).join('\n');

              const system = `You are a franchise sales consultant AI for Franchise Kart, continuing a real WhatsApp conversation.\n\nReal brand portfolio: ${brandsCtx}\n\nCRITICAL RULE: Never invent statistics or figures not given above. Keep the reply to 2-4 sentences, warm and professional, end with a question. Do not repeat a greeting if not the first message.`;
              const r = await claude(anthropicKey, system, `Conversation so far:\n${convo}\n\nDraft the next reply.`, 400);
              const waMessageId = await sendWhatsAppReply(whatsappToken, whatsappPhoneId, msg.phone, r.text);

              await db.from('whatsapp_inbound_messages').update({ replied: true, replied_at: nowIso, reply_text: r.text }).eq('id', msg.id);
              await db.from('system_events').insert({ event_type: 'ai_reply_sent', payload: { lead_id: msg.lead_id, reply: r.text, whatsapp_message_id: waMessageId, source: 'heartbeat_retry' }, processed: true, processed_at: nowIso });
              await logExec({ action: 'whatsapp_reply', status: 'success', department_code: 'SALES', input_summary: `msg ${msg.id} from ${msg.phone}`, output_summary: r.text.slice(0, 300), input_tokens: r.inputTokens, output_tokens: r.outputTokens, latency_ms: Date.now() - t0 });
              repliesSent++;
            } catch (replyErr) {
              const errMsg = replyErr instanceof Error ? replyErr.message : String(replyErr);
              console.log('REPLY FAILED', msg.id, errMsg);
              await db.from('system_events').insert({ event_type: 'ai_reply_failed', payload: { message_id: msg.id, error: errMsg }, processed: true, processed_at: nowIso });
              await logExec({ action: 'whatsapp_reply', status: 'failure', department_code: 'SALES', input_summary: `msg ${msg.id} from ${msg.phone}`, error: errMsg });
            }
          }

          detail = (unreplied?.length ?? 0) > 0
            ? `${unreplied!.length} unreplied message(s), ${repliesSent} AI repl${repliesSent === 1 ? 'y' : 'ies'} sent${replySkippedReason ? ` (${replySkippedReason})` : ''}`
            : 'No unreplied messages';
        }

        else if (task.action === 'qualify_leads') {
          const { data: candidateLeads } = await db.from('leads')
            .select('id, contact_name, stage, lead_score')
            .in('stage', ['new', 'contacted'])
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(15);

          let qualifiedCount = 0;
          let lostCount = 0;
          let noChangeCount = 0;

          for (const lead of candidateLeads ?? []) {
            const { data: history } = await db.from('whatsapp_inbound_messages')
              .select('message_text, reply_text').eq('lead_id', lead.id).order('created_at', { ascending: true });
            if (!history || history.length === 0) continue;

            const convo = history.map((h: any) => `Prospect: ${h.message_text}${h.reply_text ? `\nAgent: ${h.reply_text}` : ''}`).join('\n');

            const system = `You are a strict lead qualification analyst for a franchise consulting company. Analyze the real conversation given and output ONLY JSON (no markdown fences):\n{\"new_stage\": \"contacted\" | \"qualified\" | \"lost\" | \"no_change\", \"reasoning\": \"one sentence, cite specific evidence from the conversation\", \"confidence\": \"high\" | \"medium\" | \"low\"}\n\nRules:\n- \"contacted\": at least one AI reply has been sent (default if there's a real exchange and no stronger signal).\n- \"qualified\": ONLY if the prospect showed concrete buying signals — mentioned a real budget/investment amount, asked about next steps (meeting, application, documents), or explicitly confirmed serious interest. Do not qualify on vague interest alone.\n- \"lost\": ONLY if the prospect explicitly said not interested, or asked to stop contact.\n- \"no_change\": if evidence is genuinely ambiguous — do not guess.\nBe conservative. A wrong \"qualified\" wastes a salesperson's time worse than a missed one.`;

            let decision: any;
            let usage = { inputTokens: 0, outputTokens: 0 };
            try {
              const r = await claude(anthropicKey, system, `Conversation:\n${convo}\n\nCurrent stage: ${lead.stage}\n\nAnalyze and decide.`, 300);
              usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
              decision = extractJson(r.text);
            } catch (parseErr) {
              console.log('QUALIFY PARSE FAILED', lead.id, String(parseErr));
              await logExec({ action: 'qualify_lead', status: 'failure', department_code: 'SALES', input_summary: `lead ${lead.id}`, error: String(parseErr).slice(0, 300) });
              continue;
            }

            const proposedStage = decision.new_stage;
            if (proposedStage === 'no_change' || !AI_ALLOWED_STAGES.includes(proposedStage)) {
              noChangeCount++;
              continue;
            }
            const stageOrder = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'closed', 'lost'];
            const currentIdx = stageOrder.indexOf(lead.stage);
            const proposedIdx = stageOrder.indexOf(proposedStage);
            if (proposedStage !== 'lost' && proposedIdx <= currentIdx) { noChangeCount++; continue; }

            await db.from('leads').update({ stage: proposedStage }).eq('id', lead.id);
            await db.from('system_events').insert({
              event_type: 'lead_stage_changed',
              payload: { lead_id: lead.id, from_stage: lead.stage, to_stage: proposedStage, reasoning: decision.reasoning, confidence: decision.confidence, source: 'ai_qualification' },
              processed: true, processed_at: nowIso,
            });
            await logExec({ action: 'qualify_lead', status: 'success', department_code: 'SALES', input_summary: `lead ${lead.id} (${lead.stage})`, output_summary: `${proposedStage}: ${decision.reasoning}`, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens });
            if (proposedStage === 'qualified') qualifiedCount++;
            if (proposedStage === 'lost') lostCount++;
          }

          detail = `${(candidateLeads ?? []).length} candidate(s) reviewed: ${qualifiedCount} qualified, ${lostCount} marked lost, ${noChangeCount} unchanged`;
        }

        else {
          status = 'skipped';
          detail = `Unknown action: ${task.action}`;
        }
      } catch (taskErr) {
        status = 'failed';
        detail = taskErr instanceof Error ? taskErr.message : 'Unknown error';
        console.log('TASK FAILED', task.task_key, detail);
        await logExec({ action: task.action, status: 'failure', error: detail });
      }

      const nextRun = new Date(Date.now() + task.interval_minutes * 60000).toISOString();
      await db.from('scheduled_tasks').update({ last_run_at: nowIso, last_status: `${status}: ${detail}`.slice(0, 500), next_run_at: nextRun }).eq('id', task.id);
      results.push({ task: task.task_key, status, detail });
    }

    return ok({ checked_at: nowIso, tasks_run: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('HEARTBEAT ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
