// dashboard-engine v2 — closes gaps identified against the Founder Vision
// Audit spec: proposal status, invoice status breakdown, tasks, agent activity
// feed, risk indicators, WhatsApp/voice/marketing sections, training stats,
// milestone tracker, and a separate LLM-powered strategic-recommendations
// action (kept separate from get_dashboard so the main call stays fast).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function llmFetch(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  let errMsg = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) return res;
    errMsg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) { errMsg = e instanceof Error ? e.message : String(e); }
  const gKey = Deno.env.get('GEMINI_API_KEY');
  if (gKey) {
    const sys = typeof payload.system === 'string' ? payload.system : '';
    const msgs = Array.isArray(payload.messages) ? payload.messages : [];
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

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID' };
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>, id?: string) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: id || '', message, ...(data ? { data } : {}) })); }
function errRes(message: string, status: number, id?: string): Response { log('ERROR', message, undefined, id); return new Response(JSON.stringify({ error: message, correlationId: id }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function okRes(data: unknown, id?: string): Response { return new Response(JSON.stringify({ ...(data as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

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

function startOfDay(d: Date): string { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString(); }
function startOfWeek(d: Date): string { const x = new Date(d); const day = x.getDay(); const diff = (day === 0 ? -6 : 1) - day; x.setDate(x.getDate() + diff); x.setHours(0, 0, 0, 0); return x.toISOString(); }
function startOfMonth(d: Date): string { return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }
function startOfQuarter(d: Date): string { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1).toISOString(); }
function startOfYear(d: Date): string { return new Date(d.getFullYear(), 0, 1).toISOString(); }

async function buildDashboard(db: any): Promise<Record<string, unknown>> {
  const now = new Date();
  const todayIso = startOfDay(now);
  const weekIso = startOfWeek(now);
  const monthIso = startOfMonth(now);
  const quarterIso = startOfQuarter(now);
  const yearIso = startOfYear(now);

  const { data: paidInvoices } = await db.from('company_invoices').select('total_inr, amount_received_inr, payment_received_at, status').not('payment_received_at', 'is', null);
  const sumSince = (iso: string) => (paidInvoices ?? []).filter((r: any) => r.payment_received_at && r.payment_received_at >= iso).reduce((s: number, r: any) => s + Number(r.amount_received_inr ?? 0), 0);
  const revenue = { today_inr: sumSince(todayIso), week_inr: sumSince(weekIso), mtd_inr: sumSince(monthIso), qtd_inr: sumSince(quarterIso), ytd_inr: sumSince(yearIso) };

  const { data: targets } = await db.from('company_annual_targets').select('company_id, year, revenue_target_inr').eq('year', now.getFullYear());
  const targetVsAchievement = (targets ?? []).map((t: any) => ({ company_id: t.company_id, target_inr: Number(t.revenue_target_inr), achieved_ytd_inr: revenue.ytd_inr, pct: Number(t.revenue_target_inr) > 0 ? Math.round((revenue.ytd_inr / Number(t.revenue_target_inr)) * 10000) / 100 : null }));

  const { data: milestones } = await db.from('company_revenue_milestones').select('*').order('year', { ascending: true }).order('quarter', { ascending: true });
  const milestoneTracker = (milestones ?? []).map((m: any) => ({
    company_id: m.company_id, year: m.year, quarter: m.quarter, target_inr: Number(m.target_inr), actual_inr: Number(m.actual_inr ?? 0),
    status: m.status, target_date: m.target_date, note: 'Computed straight-line pacing from the annual target, not a founder-set checkpoint.',
  }));

  const { data: allInvoices } = await db.from('company_invoices').select('status, total_inr, amount_received_inr');
  const invoiceBreakdown: Record<string, { count: number; total_inr: number }> = {};
  for (const inv of allInvoices ?? []) {
    const s = (inv as any).status || 'unknown';
    if (!invoiceBreakdown[s]) invoiceBreakdown[s] = { count: 0, total_inr: 0 };
    invoiceBreakdown[s].count++;
    invoiceBreakdown[s].total_inr += Number((inv as any).total_inr ?? 0);
  }

  const { data: outstandingInvoices } = await db.from('company_invoices').select('id, client_name, total_inr, amount_received_inr, status, sent_at').in('status', ['sent']);
  const outstanding = (outstandingInvoices ?? []).map((r: any) => ({ id: r.id, client_name: r.client_name, outstanding_inr: Number(r.total_inr ?? 0) - Number(r.amount_received_inr ?? 0), sent_at: r.sent_at }));
  const totalOutstandingInr = outstanding.reduce((s, r) => s + r.outstanding_inr, 0);

  const { data: pendingInvoiceApprovals } = await db.from('company_invoices').select('id, client_name, total_inr, created_at').eq('status', 'pending_approval').order('created_at', { ascending: true });
  const { data: pendingApprovals } = await db.from('approvals').select('id, department_code, action_type, amount_inr, risk_level, reason, created_at').is('decided_at', null).order('created_at', { ascending: true }).limit(20);

  const { data: leads } = await db.from('leads').select('id, stage, lead_source, source, created_at, next_followup, is_active');
  const leadsBySource: Record<string, number> = {};
  const leadsByStage: Record<string, number> = {};
  for (const l of leads ?? []) {
    const src = (l as any).source || (l as any).lead_source || 'unspecified';
    leadsBySource[src] = (leadsBySource[src] || 0) + 1;
    leadsByStage[(l as any).stage || 'unknown'] = (leadsByStage[(l as any).stage || 'unknown'] || 0) + 1;
  }
  const leadsToday = (leads ?? []).filter((l: any) => l.created_at >= todayIso).length;
  const leadsThisWeek = (leads ?? []).filter((l: any) => l.created_at >= weekIso).length;
  const followupsDue = (leads ?? []).filter((l: any) => l.is_active && l.next_followup && l.next_followup <= now.toISOString()).length;

  const { count: meetingsToday } = await db.from('meetings').select('id', { count: 'exact', head: true }).gte('scheduled_at', todayIso).lt('scheduled_at', new Date(now.getTime() + 86400000).toISOString());

  const { count: whatsappTotal } = await db.from('whatsapp_inbound_messages').select('id', { count: 'exact', head: true });
  const { count: whatsappUnreplied } = await db.from('whatsapp_inbound_messages').select('id', { count: 'exact', head: true }).eq('replied', false);

  const { data: voiceCalls24h } = await db.from('voice_call_log').select('status').gte('created_at', new Date(now.getTime() - 86400000).toISOString());
  const voiceActivity = { calls_last_24h: (voiceCalls24h ?? []).length, failed_last_24h: (voiceCalls24h ?? []).filter((v: any) => v.status === 'failed').length };

  const calls = { status: 'not_tracked', note: 'No phone-call logging table exists in the schema yet.' };

  const { data: departments } = await db.from('departments').select('code, name, mission, automation_level, kpis').eq('is_active', true).order('code');
  const { data: agentCounts } = await db.from('ai_agents').select('id, department_id').eq('is_active', true);
  const { data: deptRows } = await db.from('departments').select('id, code');
  const deptIdToCode = new Map((deptRows ?? []).map((d: any) => [d.id, d.code]));
  const agentsPerDept: Record<string, number> = {};
  for (const a of agentCounts ?? []) { const code = deptIdToCode.get((a as any).department_id) as string | undefined; if (code) agentsPerDept[code] = (agentsPerDept[code] || 0) + 1; }
  const departmentSnapshot = (departments ?? []).map((d: any) => ({ code: d.code, name: d.name, automation_level: d.automation_level, kpis: d.kpis, agents_assigned: agentsPerDept[d.code] || 0 }));

  const todayDate = now.toISOString().slice(0, 10);
  const { data: todaysWorkday } = await db.from('agent_workday').select('status, self_rating, manager_rating, real_activity_count, tasks_planned, tasks_completed').eq('work_date', todayDate);
  const agentsReportingToday = (todaysWorkday ?? []).length;
  const ratedToday = (todaysWorkday ?? []).filter((w: any) => w.manager_rating);
  const avgManagerRating = ratedToday.length > 0 ? Math.round((ratedToday.reduce((s: number, w: any) => s + w.manager_rating, 0) / ratedToday.length) * 10) / 10 : null;

  const tasksPlannedToday = (todaysWorkday ?? []).reduce((s: number, w: any) => s + (w.tasks_planned || 0), 0);
  const tasksCompletedToday = (todaysWorkday ?? []).reduce((s: number, w: any) => s + (w.tasks_completed || 0), 0);
  const { data: orchTasks } = await db.from('orchestration_tasks').select('status');
  const orchByStatus: Record<string, number> = {};
  for (const t of orchTasks ?? []) { orchByStatus[(t as any).status || 'unknown'] = (orchByStatus[(t as any).status || 'unknown'] || 0) + 1; }
  const tasks = { workday_tasks_planned_today: tasksPlannedToday, workday_tasks_completed_today: tasksCompletedToday, software_factory_tasks_by_status: orchByStatus };

  const { data: dispatch24h } = await db.from('agent_dispatch_log').select('status').gte('created_at', new Date(now.getTime() - 86400000).toISOString());
  const dispatchTotal = (dispatch24h ?? []).length;
  const dispatchFailed = (dispatch24h ?? []).filter((d: any) => d.status === 'failed' || d.status === 'error').length;

  const { data: activityFeed } = await db.from('agent_dispatch_log').select('agent_id, action, status, created_at').order('created_at', { ascending: false }).limit(15);

  const { data: leadDocs } = await db.from('lead_documents').select('document_type, proposed_amount_inr, created_at');
  const proposalStatus = {
    proposals_drafted: (leadDocs ?? []).filter((d: any) => d.document_type === 'proposal').length,
    business_models_drafted: (leadDocs ?? []).filter((d: any) => d.document_type === 'business_model').length,
    avg_proposed_amount_inr: (() => { const amts = (leadDocs ?? []).filter((d: any) => d.document_type === 'business_model' && d.proposed_amount_inr != null).map((d: any) => Number(d.proposed_amount_inr)); return amts.length > 0 ? Math.round(amts.reduce((a: number, b: number) => a + b, 0) / amts.length) : null; })(),
  };

  const { data: trainingModules } = await db.from('training_curriculum').select('id');
  const { data: trainingCompletions } = await db.from('training_completions').select('agent_id, score');
  const trainingCompletedAgents = new Set((trainingCompletions ?? []).map((c: any) => c.agent_id));
  const training = { modules_published: (trainingModules ?? []).length, completions_total: (trainingCompletions ?? []).length, agents_with_completion: trainingCompletedAgents.size };

  const { data: campaigns } = await db.from('marketing_campaigns').select('status, channel');
  const campaignsByStatus: Record<string, number> = {};
  for (const c of campaigns ?? []) { campaignsByStatus[(c as any).status || 'unknown'] = (campaignsByStatus[(c as any).status || 'unknown'] || 0) + 1; }

  const { data: unreadNotifications } = await db.from('founder_notifications').select('id, type, title, detail, department_code, amount_inr, created_at').eq('is_read', false).order('created_at', { ascending: false }).limit(20);
  const { data: ideas } = await db.from('brain_business_ideas').select('status');
  const ideasByStatus: Record<string, number> = {};
  for (const i of ideas ?? []) { ideasByStatus[(i as any).status || 'unknown'] = (ideasByStatus[(i as any).status || 'unknown'] || 0) + 1; }

  const riskIndicators: { area: string; risk: string; severity: 'low' | 'medium' | 'high' }[] = [];
  if (totalOutstandingInr > 0) riskIndicators.push({ area: 'Collections', risk: `₹${totalOutstandingInr.toLocaleString('en-IN')} outstanding, uncollected`, severity: totalOutstandingInr > 1000000 ? 'high' : 'medium' });
  if (dispatchTotal > 0 && dispatchFailed / dispatchTotal > 0.15) riskIndicators.push({ area: 'Automation', risk: `${Math.round((dispatchFailed / dispatchTotal) * 100)}% agent dispatch failure rate (24h)`, severity: 'high' });
  if ((whatsappUnreplied ?? 0) > 0) riskIndicators.push({ area: 'Customer Response', risk: `${whatsappUnreplied} unreplied WhatsApp message(s)`, severity: 'medium' });
  if (training.modules_published === 0) riskIndicators.push({ area: 'Workforce', risk: 'No training modules published yet — AI workforce has no structured onboarding.', severity: 'low' });
  if ((campaigns ?? []).length === 0) riskIndicators.push({ area: 'Marketing', risk: 'No marketing campaigns tracked yet.', severity: 'low' });

  const alerts: { severity: 'high' | 'medium'; message: string }[] = [];
  if (dispatchTotal > 0 && dispatchFailed / dispatchTotal > 0.2) alerts.push({ severity: 'high', message: `${dispatchFailed} of ${dispatchTotal} agent dispatches failed in the last 24h.` });
  if (totalOutstandingInr > 0) alerts.push({ severity: 'medium', message: `₹${totalOutstandingInr.toLocaleString('en-IN')} outstanding across ${outstanding.length} sent invoice(s).` });
  if ((pendingInvoiceApprovals ?? []).length > 0) alerts.push({ severity: 'high', message: `${(pendingInvoiceApprovals ?? []).length} invoice(s) awaiting your approval.` });
  if (followupsDue > 0) alerts.push({ severity: 'medium', message: `${followupsDue} lead follow-up(s) overdue.` });
  if (agentsReportingToday === 0) alerts.push({ severity: 'medium', message: 'No agents have reported today yet.' });

  let health = 100;
  if (dispatchTotal > 0) health -= Math.round((dispatchFailed / dispatchTotal) * 30);
  if ((pendingInvoiceApprovals ?? []).length > 0) health -= Math.min(15, (pendingInvoiceApprovals ?? []).length * 5);
  if (followupsDue > 0) health -= Math.min(15, followupsDue * 2);
  if (agentsReportingToday === 0) health -= 10;
  health = Math.max(0, Math.min(100, health));

  return {
    generated_at: now.toISOString(),
    business_health_score: health,
    revenue,
    revenue_target_vs_achievement: targetVsAchievement,
    milestone_tracker: milestoneTracker,
    invoice_status_breakdown: invoiceBreakdown,
    outstanding_receivables_inr: totalOutstandingInr,
    outstanding_invoices: outstanding,
    pending_invoice_approvals: pendingInvoiceApprovals ?? [],
    pending_approvals: pendingApprovals ?? [],
    proposal_status: proposalStatus,
    leads: { total: (leads ?? []).length, today: leadsToday, this_week: leadsThisWeek, by_source: leadsBySource, by_stage: leadsByStage, followups_due: followupsDue },
    meetings_today: meetingsToday ?? 0,
    whatsapp: { total_inbound: whatsappTotal ?? 0, unreplied: whatsappUnreplied ?? 0 },
    voice_agent_activity: voiceActivity,
    calls,
    departments: departmentSnapshot,
    workforce: { agents_reporting_today: agentsReportingToday, total_active_agents: (agentCounts ?? []).length, avg_manager_rating_today: avgManagerRating },
    tasks,
    automation_health: { dispatches_last_24h: dispatchTotal, failed_last_24h: dispatchFailed, failure_rate_pct: dispatchTotal > 0 ? Math.round((dispatchFailed / dispatchTotal) * 10000) / 100 : 0 },
    agent_activity_feed: activityFeed ?? [],
    training,
    marketing: { campaigns_by_status: campaignsByStatus },
    innovation_pipeline: ideasByStatus,
    unread_notifications: unreadNotifications ?? [],
    critical_alerts: alerts,
    risk_indicators: riskIndicators,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  const db = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: authHeader ? { Authorization: authHeader } : {} } });

  try {
    const user = await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);

    let action = 'get_dashboard';
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({} as any));
      if (body?.action) action = body.action;
    }

    if (action === 'get_dashboard') {
      const dashboard = await buildDashboard(db);
      log('info', 'Dashboard generated', { healthScore: dashboard.business_health_score }, id);
      return okRes(dashboard, id);
    }

    if (action === 'get_insights') {
      const dashboard = await buildDashboard(db);
      const principlesBlock = await getFounderPrinciplesBlock(db, 'EXECUTIVE');
      const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!apiKey) return errRes('ANTHROPIC_API_KEY not configured', 500, id);
      const system = `You are the Executive Brain of FKAIOS, producing 3-5 strategic recommendations for the Founder based ONLY on the real dashboard data given below. Ground every recommendation in a specific number from the data — never generic advice like "improve marketing". If the data shows almost nothing happening (e.g. zero revenue, zero leads today), say that plainly and recommend the most basic next action, don't inflate it into a bigger strategic narrative than the data supports.${principlesBlock}\n\nRespond with ONLY valid JSON: {"recommendations": [{"title": string, "detail": string, "priority": "high"|"medium"|"low"}]}`;
      const res = await llmFetch(apiKey, { model: 'claude-sonnet-4-6', max_tokens: 1200, system, messages: [{ role: 'user', content: JSON.stringify(dashboard).slice(0, 8000) }] });
      if (!res.ok) return errRes(`LLM error: ${(await res.text()).slice(0, 300)}`, 502, id);
      const data = await res.json() as any;
      const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text || '').join('\n');
      const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      try {
        const parsed = JSON.parse(cleaned);
        return okRes({ recommendations: parsed.recommendations ?? [] }, id);
      } catch {
        return errRes('LLM returned non-JSON output for insights', 502, id);
      }
    }

    return errRes(`Unknown action: ${action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'dashboard-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
