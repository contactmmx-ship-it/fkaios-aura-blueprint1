'use client';
import { useMemo, useState } from 'react';
import { Radio, ArrowRight, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Clock, Sparkles, Activity, IndianRupee, ShieldAlert } from 'lucide-react';
import LineagePanel, { LineageSpec, LineageRow } from './LineagePanel';

// LEVEL 1 — The Founder Story. Replaces "cockpit syndrome" with a plain-language
// account of what the enterprise is doing right now, a live "watch it think"
// stream, and exactly what needs the Founder. Everything is real: computed from
// the same live governance payload. When reality is thin, it says so honestly
// (Truth Before Beauty) rather than inventing activity. The full cockpit lives
// one click away via the toggle — nothing is removed, just progressively disclosed.

interface StreamEvent { ts: string; actor: string; actor_type: string; action: string; outcome: string; status: string; }
interface Collab { from_agent: string; to_agent: string; task: string; status: string; requires_founder_approval: boolean; created_at: string; }
interface DeptStatus { code: string; name: string; staffed: number; output_24h: number; status: string; reason: string; }
interface SilenceAlert { title: string; detail: string; department: string; created_at: string; }
interface Revenue { invoices_total: number; invoiced_inr: number; received_inr: number; paid_invoices: number; }
interface StoryData {
  revenue?: Revenue;
  department_status?: DeptStatus[];
  alerts?: SilenceAlert[];
  workforce?: { is_active: boolean; status: string; total_tasks_completed: number | null; tasks_completed: number; name: string; success_rate: number | null; department?: string | null }[];
  activity_stream?: StreamEvent[];
  collaboration?: Collab[];
  approval_queue?: { action_type: string; risk_level: string; amount_inr: number | null; reason: string }[];
  executive_cycles?: { founder_briefing: string; opportunities: any[]; risks: any[]; created_at: string }[];
  kpi_latest?: Record<string, { value: number }>;
  summary?: { violations: number } | null;
}

function rel(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function hhmm(iso: string) { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

const statusTone: Record<string, string> = { completed: 'text-emerald-400', success: 'text-emerald-400', failed: 'text-red-400', error: 'text-red-400', dispatched: 'text-slate-400', running: 'text-cyan-400' };

// Hoisted (never created during render): a number that carries its own lineage.
// Clicking it opens the source rows that produced it — Palantir's rule that a
// figure on a screen is a claim until you can walk it back to the row.
function NumBtn({ value, tone, onOpen }: { value: string | number; tone?: string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} title="Click to see the source rows behind this number"
      className={`font-bold ${tone ?? 'text-white'} underline decoration-dotted decoration-slate-500 underline-offset-4 hover:decoration-cyan-400 cursor-pointer`}>
      {value}
    </button>
  );
}

export default function FounderStory({ data, expanded, onToggle }: { data: StoryData; expanded: boolean; onToggle: () => void }) {
  const wf = data.workforce ?? [];
  const stream = data.activity_stream ?? [];
  const collab = data.collaboration ?? [];
  const approvals = data.approval_queue ?? [];
  const cycle = (data.executive_cycles ?? [])[0];
  const rev = data.revenue ?? { invoices_total: 0, invoiced_inr: 0, received_inr: 0, paid_invoices: 0 };
  const depts = data.department_status ?? [];
  const silences = data.alerts ?? [];
  const noGo = depts.filter(d => d.status === 'NO_GO');
  const going = depts.filter(d => d.status === 'GO');
  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  const s = useMemo(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const last24 = stream.filter(e => new Date(e.ts).getTime() > dayAgo);
    const producing = wf.filter(a => (a.total_tasks_completed ?? 0) > 0 || a.tasks_completed > 0);
    const active = wf.filter(a => a.is_active && a.status === 'active');
    const matchAction = (needle: string) => last24.filter(e => (e.action || '').toLowerCase().includes(needle));
    const discoveredEvents = [...matchAction('hunt'), ...matchAction('discover')];
    const qualifiedEvents = matchAction('qualify');
    const failureEvents = last24.filter(e => e.status === 'failed' || e.status === 'error');
    const topWorker = [...wf].sort((a, b) => (b.total_tasks_completed ?? 0) - (a.total_tasks_completed ?? 0))[0];
    const approvalRows = [
      ...approvals.map(a => ({ primary: a.action_type, secondary: a.reason, status: a.risk_level, meta: a.amount_inr != null ? `₹${Number(a.amount_inr).toLocaleString('en-IN')}` : undefined } as LineageRow)),
      ...collab.filter(c => c.requires_founder_approval && c.status !== 'completed').map(c => ({ primary: `${c.from_agent} → ${c.to_agent}`, secondary: c.task, status: c.status, ts: c.created_at } as LineageRow)),
    ];
    return {
      ops24: last24.length, producing: producing.length, total: wf.length, active: active.length,
      discovered: discoveredEvents.length, qualified: qualifiedEvents.length,
      failures: failureEvents.length, topWorker, pendingApprovals: approvalRows.length,
      last24, producingList: producing, discoveredEvents, qualifiedEvents, failureEvents, approvalRows,
    };
  }, [wf, stream, collab, approvals]);

  // ── P2 LINEAGE (Palantir principle): every number clicks through to its
  // source rows, built from the SAME live payload — zero extra queries, zero
  // fabrication. A generic panel shows source, derivation, rows, reconciliation.
  const [lineage, setLineage] = useState<LineageSpec | null>(null);
  const evRow = (e: StreamEvent): LineageRow => ({ primary: e.actor, secondary: `${e.action}${e.outcome ? ` — ${e.outcome}` : ''}`, status: e.status, ts: e.ts });
  const streamCaveat = 'Computed over the live activity_stream payload (agent_dispatch_log joined to agent names + execution_log), capped at the 60 most recent events by the server, filtered to the last 24 hours client-side.';

  // Revenue is THE number. Its lineage is the most important one in the system:
  // it must be impossible to believe ₹0 is a rendering bug rather than reality.
  const revenueLineage = (): LineageSpec => ({
    title: 'Revenue received (all time)',
    value: inr(rev.received_inr),
    source: 'company_invoices (via governance-dashboard → revenue)',
    derivation: 'SUM(amount_received_inr) across every row in company_invoices — no date filter, all time. Invoiced total is SUM(total_inr). An invoice counts as paid when amount_received_inr > 0.',
    reconciles: false,
    rows: rev.invoices_total === 0 ? [] : [
      { primary: 'Invoices on record', secondary: `${rev.invoices_total} total · ${rev.paid_invoices} with money received`, meta: `Invoiced ${inr(rev.invoiced_inr)} · Received ${inr(rev.received_inr)}` },
    ],
    emptyTruth: 'company_invoices is EMPTY. Zero invoices have ever been created, so zero rupees have ever been received. This is not a display error and not a loading state — the enterprise has never billed a customer. ₹0 is the true and current state.',
  });

  // A NO-GO chip is an accusation against a department. It must carry its evidence:
  // who is staffed there, and what (if anything) they actually shipped in 24h.
  const deptLineage = (d: DeptStatus): LineageSpec => {
    const roster = wf.filter(a => (a.department ?? '') === d.code);
    return {
      title: `${d.name} — reporting ${d.status.replace('_', '-')}`,
      value: `${d.output_24h} outcomes / 24h`,
      source: 'departments × ai_agents × agent_dispatch_log (via governance-dashboard → department_status)',
      derivation: `Staffed = agents whose department = '${d.code}'. Output = agent_dispatch_log rows from those agents in the last 24h with status 'completed' or 'success'. A staffed department with 0 outcomes reports NO-GO — silence is never consent (Mission Control rule). ${d.reason}.`,
      reconciles: false,
      rows: roster.length === 0
        ? []
        : roster.map(a => ({
            primary: a.name,
            secondary: a.status === 'active' ? 'on duty' : `status: ${a.status}`,
            status: (a.total_tasks_completed ?? 0) > 0 ? 'completed' : 'pending',
            meta: `${a.total_tasks_completed ?? 0} lifetime tasks · ${a.tasks_completed} today`,
          } as LineageRow)),
      emptyTruth: `No agents are assigned to ${d.name}. It is an org-chart entry with nobody in it — the console reports UNSTAFFED rather than pretending coverage exists.`,
    };
  };

  const recommendation = cycle?.founder_briefing
    || (Array.isArray(cycle?.opportunities) && cycle!.opportunities[0]
        ? (typeof cycle!.opportunities[0] === 'string' ? cycle!.opportunities[0] : cycle!.opportunities[0]?.title ?? cycle!.opportunities[0]?.opportunity)
        : null);

  return (
    <div className="space-y-4">
      {lineage && <LineagePanel spec={lineage} onClose={() => setLineage(null)} />}
      {/* ─── THE STORY ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/30 px-6 py-5">
        <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ background: 'radial-gradient(700px 160px at 12% -10%, rgba(59,130,246,0.25), transparent)' }} />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" /></span>
            <h2 className="text-lg font-bold text-white">{greeting()}, Chairman.</h2>
            <span className="text-[11px] text-slate-500">Here is your enterprise right now</span>
            <span className="ml-auto text-[10px] text-slate-600 border border-slate-800 rounded-full px-2 py-0.5">every underlined number opens its source rows</span>
          </div>

          <div className="space-y-2 text-sm text-slate-300 leading-relaxed max-w-3xl">
            <p>
              In the last 24 hours your AI workforce ran{' '}
              <NumBtn value={s.ops24} onOpen={() => setLineage({
                title: 'Operations in the last 24 hours', value: String(s.ops24),
                source: 'agent_dispatch_log + execution_log (via governance-dashboard → activity_stream)',
                derivation: streamCaveat,
                rows: s.last24.map(evRow),
                emptyTruth: 'No agent dispatches or engine executions were recorded in the last 24h. The workforce did nothing measurable.',
              })} /> operations.{' '}
              <NumBtn value={s.producing} tone={s.producing > 0 ? 'text-emerald-300' : 'text-amber-300'} onOpen={() => setLineage({
                title: 'Employees that produced real work', value: String(s.producing),
                source: 'ai_agents.total_tasks_completed + agent_workday.tasks_completed (via governance-dashboard → workforce)',
                derivation: 'An agent counts as producing when total_tasks_completed > 0 OR today\'s agent_workday.tasks_completed > 0. Lifetime output, not a 24h window.',
                rows: s.producingList.map(a => ({ primary: a.name, secondary: a.department ? `dept: ${a.department}` : undefined, status: a.status, meta: `${a.total_tasks_completed ?? 0} lifetime tasks${a.success_rate != null ? ` · ${Math.round(Number(a.success_rate))}% success` : ''}` } as LineageRow)),
                emptyTruth: 'Not one agent has ever completed a task. The workforce is nameplates only.',
              })} /> of{' '}
              <NumBtn value={s.total} onOpen={() => setLineage({
                title: 'Total AI employees on the roster', value: String(s.total),
                source: 'ai_agents (via governance-dashboard → workforce)',
                derivation: 'Every row in ai_agents returned by the governance payload — active and idle alike. Being on the roster is not evidence of output; see the producing count.',
                rows: [...wf].sort((a, b) => (b.total_tasks_completed ?? 0) - (a.total_tasks_completed ?? 0)).map(a => ({ primary: a.name, secondary: a.department ? `dept: ${a.department}` : undefined, status: a.status, meta: `${a.total_tasks_completed ?? 0} lifetime tasks` } as LineageRow)),
              })} /> employees produced real work
              {s.producing < s.total && <span className="text-slate-400"> — the other {s.total - s.producing} were scheduled but idle</span>}.
              {s.topWorker && (s.topWorker.total_tasks_completed ?? 0) > 0 && <> Your hardest worker is <b className="text-white">{s.topWorker.name}</b> ({s.topWorker.total_tasks_completed} tasks{s.topWorker.success_rate != null ? `, ${Math.round(Number(s.topWorker.success_rate))}% success` : ''}).</>}
            </p>
            <p>
              Commercially, the enterprise {s.discovered > 0 ? <>discovered/hunted{' '}
                <NumBtn value={s.discovered} onOpen={() => setLineage({
                  title: 'Lead discovery / hunt operations (24h)', value: String(s.discovered),
                  source: 'agent_dispatch_log + execution_log (activity_stream)',
                  derivation: `Events in the last 24h whose action contains "hunt" or "discover". ${streamCaveat}`,
                  rows: s.discoveredEvents.map(evRow),
                })} /> lead batches</> : <>ran no new lead discovery</>}
              {' '}and the qualifier {s.qualified > 0 ? <>ran{' '}
                <NumBtn value={s.qualified} onOpen={() => setLineage({
                  title: 'Lead qualification passes (24h)', value: String(s.qualified),
                  source: 'agent_dispatch_log + execution_log (activity_stream)',
                  derivation: `Events in the last 24h whose action contains "qualify". ${streamCaveat} NOTE: a qualification pass is not a qualified lead — 0 leads have ever scored ≥40 and advanced past stage='new'.`,
                  rows: s.qualifiedEvents.map(evRow),
                })} /> scoring passes</> : <>was idle</>}.
              {' '}Revenue recorded so far:{' '}
              <NumBtn value={inr(rev.received_inr)} onOpen={() => setLineage(revenueLineage())} /> — {rev.invoices_total === 0 ? 'no invoices or payments exist in production yet.' : `${rev.paid_invoices} of ${rev.invoices_total} invoices paid.`}
            </p>
            {s.failures > 0 && (
              <p className="text-amber-300/90"><AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                <NumBtn value={s.failures} tone="text-amber-300" onOpen={() => setLineage({
                  title: 'Failed operations (24h)', value: String(s.failures),
                  source: 'agent_dispatch_log + execution_log (activity_stream)',
                  derivation: `Events in the last 24h with status 'failed' or 'error'. ${streamCaveat}`,
                  rows: s.failureEvents.map(evRow),
                })} /> operations failed in the last 24h — worth a look in the activity stream below.
              </p>
            )}
            {recommendation && <p className="text-slate-300"><Sparkles className="w-3.5 h-3.5 inline mr-1 text-purple-400" /><span className="text-purple-300">CEO AI recommends: </span>{String(recommendation).slice(0, 220)}</p>}
          </div>

          {/* ── HERO NUMBER (Stripe principle: one number answers "is it working?") ── */}
          <div className="mt-5 flex flex-wrap items-end gap-6 pb-4 border-b border-slate-800">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                <IndianRupee className="w-3 h-3" /> Revenue received
              </p>
              <button onClick={() => setLineage(revenueLineage())} title="Click to see exactly why this number is what it is"
                className={`text-5xl font-bold tabular-nums leading-none block text-left underline decoration-dotted decoration-slate-700 underline-offset-8 hover:decoration-cyan-500 cursor-pointer ${rev.received_inr > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                {inr(rev.received_inr)}
              </button>
              <p className="text-[11px] text-slate-500 mt-1.5">
                {rev.invoices_total === 0
                  ? 'No invoices exist yet — the enterprise has never billed a customer.'
                  : `${rev.paid_invoices} of ${rev.invoices_total} invoices paid · ${inr(rev.invoiced_inr)} invoiced`}
              </p>
            </div>
            <div className="text-[11px] text-slate-500 pb-1">
              <p>Mission 2030: <span className="text-slate-300 font-semibold">₹1,100 Cr</span></p>
              <p className="mt-0.5">Progress: <span className="text-slate-300 font-semibold">{rev.received_inr > 0 ? '—' : '0%'}</span></p>
            </div>
          </div>

          {/* ── GO / NO-GO CONSOLES (Mission Control: silence is never consent) ── */}
          {depts.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Department consoles — reporting now</p>
              <div className="flex flex-wrap gap-1.5">
                {noGo.map(d => (
                  <button key={d.code} title={`${d.reason} — click for evidence`}
                    onClick={() => setLineage(deptLineage(d))}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-950/40 border border-red-900 px-2.5 py-1 hover:border-red-600 cursor-pointer">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    <span className="text-[11px] font-semibold text-red-300">{d.name}</span>
                    <span className="text-[9px] text-red-400/70">NO-GO</span>
                  </button>
                ))}
                {going.map(d => (
                  <button key={d.code} title={`${d.reason} — click for evidence`}
                    onClick={() => setLineage(deptLineage(d))}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-950/30 border border-emerald-900/60 px-2.5 py-1 hover:border-emerald-600 cursor-pointer">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[11px] font-medium text-emerald-300">{d.name}</span>
                    <span className="text-[9px] text-emerald-500/70">GO · {d.output_24h}</span>
                  </button>
                ))}
              </div>
              {noGo.length > 0 && (
                <p className="text-[11px] text-red-300/80 mt-2">
                  {noGo.length} department{noGo.length === 1 ? '' : 's'} staffed but produced nothing in 24h. Silence is never consent — they report NO-GO.
                </p>
              )}
            </div>
          )}

          {/* ── SILENCE MONITOR ALERTS (Datadog no-data principle) ── */}
          {silences.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {silences.map((a, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-950/30 border border-amber-900/70 px-3 py-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-200">{a.title}</p>
                    <p className="text-[11px] text-amber-200/70 leading-snug">{a.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* the one thing that matters: what needs you */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {s.pendingApprovals > 0 ? (
              <button onClick={() => setLineage({
                title: 'Decisions waiting on the Chairman',
                value: String(s.pendingApprovals),
                source: 'approvals (status=pending) + agent_task_delegations (requires_founder_approval)',
                derivation: 'Every open item in the approval queue, plus every agent-to-agent delegation flagged requires_founder_approval that has not completed. These are the items the enterprise cannot proceed past without you.',
                rows: s.approvalRows,
              })} className="flex items-center gap-2 rounded-lg bg-amber-950/40 border border-amber-800 px-3 py-1.5 hover:border-amber-600 cursor-pointer">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-sm text-amber-200 font-medium">{s.pendingApprovals} {s.pendingApprovals === 1 ? 'decision needs' : 'decisions need'} your approval</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-950/30 border border-emerald-900 px-3 py-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-200">Nothing needs you right now — the enterprise is running itself.</span>
              </div>
            )}
            <button onClick={onToggle} className="ml-auto flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 border border-slate-700 rounded-lg px-3 py-1.5">
              {expanded ? <>Hide the full command center <ChevronUp className="w-3.5 h-3.5" /></> : <>Open the full command center <ChevronDown className="w-3.5 h-3.5" /></>}
            </button>
          </div>
        </div>
      </div>

      {/* ─── WATCH IT THINK: live enterprise stream ─────────────────── */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Radio className="w-4 h-4 text-cyan-400" />
          <p className="text-sm font-semibold text-white">Watch the company work</p>
          <span className="text-[10px] text-slate-500">live · newest first · every event is a real AI action</span>
        </div>
        {stream.length === 0 ? (
          <p className="text-xs text-slate-500">No recorded activity yet. When agents execute, their actions stream here in real time.</p>
        ) : (
          <div className="relative max-h-80 overflow-y-auto pr-1">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-800" />
            <div className="space-y-2.5">
              {stream.slice(0, 16).map((e, i) => (
                <div key={i} className="relative flex items-start gap-3 pl-5">
                  <span className={`absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-slate-950 ${e.status === 'failed' || e.status === 'error' ? 'bg-red-500' : e.status === 'completed' || e.status === 'success' ? 'bg-emerald-500' : 'bg-cyan-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-500 tabular-nums">{hhmm(e.ts)}</span>
                      <span className={`text-xs font-semibold text-white`}>{e.actor}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${e.actor_type === 'agent' ? 'bg-blue-950/60 text-blue-300 border border-blue-900' : 'bg-purple-950/50 text-purple-300 border border-purple-900'}`}>{e.actor_type}</span>
                      <ArrowRight className="w-3 h-3 text-slate-600" />
                      <span className="text-xs text-slate-300">{e.action}</span>
                      <span className={`text-[10px] ${statusTone[e.status] ?? 'text-slate-400'}`}>· {e.status}</span>
                    </div>
                    {e.outcome && <p className="text-[11px] text-slate-500 leading-snug mt-0.5 truncate">{e.outcome}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── AI COLLABORATION: how work moves between agents ────────── */}
      {collab.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-emerald-400" />
            <p className="text-sm font-semibold text-white">How work is delegated</p>
            <span className="text-[10px] text-slate-500">who handed what to whom</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {collab.slice(0, 6).map((c, i) => (
              <div key={i} className="flex items-center gap-2 bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
                <span className="text-[11px] font-semibold text-cyan-300 shrink-0">{c.from_agent}</span>
                <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                <span className="text-[11px] font-semibold text-white shrink-0">{c.to_agent}</span>
                <span className="text-[10px] text-slate-500 truncate flex-1">{c.task}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${c.status === 'completed' ? 'bg-emerald-950/50 text-emerald-400' : c.requires_founder_approval ? 'bg-amber-950/50 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>{c.requires_founder_approval && c.status !== 'completed' ? 'needs you' : c.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!expanded && (
        <p className="text-center text-[11px] text-slate-600 flex items-center justify-center gap-1"><Clock className="w-3 h-3" />Board, Executive Committee, Workforce dossiers, Governance, Market Intelligence and more are one click away — open the full command center above.</p>
      )}
    </div>
  );
}
