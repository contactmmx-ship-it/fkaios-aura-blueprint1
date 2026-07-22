'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, Loader2, RefreshCw, CheckCircle2, XCircle, Info } from 'lucide-react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';

// Unified Decision Center — replaces three uncoordinated "things needing a
// yes/no" queries (Approvals' generic approvals list, Governance Dashboard's
// embedded approval_queue preview, and agent_task_delegations' risk-gated
// directives introduced by this session's Executive Intelligence upgrade)
// with one sorted, actionable list. Deliberately does NOT absorb invoice
// approvals (ApprovalsPage, its own finance-engine send/approve flow) or
// project submissions (ProjectReview, its own upload+AI-review flow) — both
// have real, distinct action shapes; forcing them into one generic
// approve/reject card would be cosmetic, not a real merge.
//
// orchestrator_requests (status='awaiting_approval') is shown read-only:
// no code anywhere in this codebase transitions a request OUT of that status
// today, so a "Reject" button here would look real without doing anything —
// exactly what "no fake metrics, no placeholders" forbids. Flagged honestly
// instead of built speculatively.
//
// REFINEMENT SPRINT #6 — Decision Safety: low-risk items still execute on a
// single click (the click itself is the confirmation). High-risk items now
// require a confirmation modal. Critical financial decisions (an amount_inr
// present) show amount, the real rejected_alternatives this session's
// executive-intelligence upgrade already writes into approvals.payload, and
// require an explicit "Confirm as Founder" action — not a second identical
// button, so it reads as a CEO decision, not a second click of the same UI.

type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | string;

interface RejectedAlternative { description: string; predictedOutcome: string; score: number }

interface ApprovalItem {
  source: 'approvals';
  id: string;
  action_type: string;
  reason: string | null;
  risk_level: RiskLevel;
  amount_inr: number | null;
  payload: { rejected_alternatives?: RejectedAlternative[] } | null;
  created_at: string;
}
interface DelegationItem {
  source: 'delegation';
  id: string;
  from_agent: string;
  to_agent: string;
  task_description: string;
  risk_level: RiskLevel;
  created_at: string;
}
interface RequestItem {
  source: 'request';
  id: string;
  raw_request: string;
  department_code: string | null;
  risk_level: RiskLevel;
  created_at: string;
}
type DecisionItem = ApprovalItem | DelegationItem | RequestItem;

const riskWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
function riskTone(risk: string) {
  if (risk === 'critical' || risk === 'high') return 'bg-red-500/20 text-red-400 border-red-900';
  if (risk === 'medium') return 'bg-amber-500/20 text-amber-400 border-amber-900';
  return 'bg-slate-800 text-slate-400 border-slate-700';
}
function formatCurrency(val: number | null) {
  if (val === null || val === undefined) return null;
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
  return `₹${val.toLocaleString('en-IN')}`;
}

export function useDecisionItems() {
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [readOnlyCount, setReadOnlyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [apprRes, delRes, reqRes] = await Promise.all([
      supabase.from('approvals').select('id, action_type, reason, risk_level, amount_inr, payload, created_at').eq('status', 'pending').order('created_at', { ascending: true }),
      supabase.from('agent_task_delegations').select('id, from_agent, to_agent, task_description, context, created_at').eq('requires_founder_approval', true).neq('status', 'completed').order('created_at', { ascending: true }),
      supabase.from('orchestrator_requests').select('id, raw_request, department_code, risk_level, created_at').eq('status', 'awaiting_approval').order('created_at', { ascending: true }),
    ]);
    if (apprRes.error || delRes.error || reqRes.error) {
      setError(apprRes.error?.message || delRes.error?.message || reqRes.error?.message || 'Failed to load decisions');
      setLoading(false);
      return;
    }
    const approvals: ApprovalItem[] = (apprRes.data || []).map((a: any) => ({ source: 'approvals', id: a.id, action_type: a.action_type, reason: a.reason, risk_level: a.risk_level, amount_inr: a.amount_inr, payload: a.payload, created_at: a.created_at }));
    const delegations: DelegationItem[] = (delRes.data || []).map((d: any) => ({ source: 'delegation', id: d.id, from_agent: d.from_agent, to_agent: d.to_agent, task_description: d.task_description, risk_level: d.context?.risk_level || 'medium', created_at: d.created_at }));
    const requests: RequestItem[] = (reqRes.data || []).map((r: any) => ({ source: 'request', id: r.id, raw_request: r.raw_request, department_code: r.department_code, risk_level: r.risk_level, created_at: r.created_at }));
    const all: DecisionItem[] = [...approvals, ...delegations, ...requests].sort((a, b) => (riskWeight[b.risk_level] || 0) - (riskWeight[a.risk_level] || 0));
    setItems(all);
    setReadOnlyCount(requests.length);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { items, readOnlyCount, loading, error, reload: load };
}

export async function decideItem(item: DecisionItem, decision: 'approved' | 'rejected') {
  if (item.source === 'approvals') {
    await supabase.from('approvals').update({ status: decision, decided_by: 'founder', decided_at: new Date().toISOString() }).eq('id', item.id);
  } else if (item.source === 'delegation') {
    await supabase.from('agent_task_delegations').update({
      requires_founder_approval: false,
      status: decision === 'rejected' ? 'cancelled' : undefined,
    }).eq('id', item.id);
  }
}

function isHighRisk(item: DecisionItem) { return item.risk_level === 'high' || item.risk_level === 'critical'; }
function isCriticalFinancial(item: DecisionItem) { return item.source === 'approvals' && item.amount_inr !== null && item.amount_inr !== undefined; }

export default function DecisionCenter({ compact = false, limit }: { compact?: boolean; limit?: number }) {
  const { items, readOnlyCount, loading, error, reload } = useDecisionItems();
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ item: DecisionItem; decision: 'approved' | 'rejected' } | null>(null);

  async function execute(item: DecisionItem, decision: 'approved' | 'rejected') {
    setDecidingId(item.id);
    await decideItem(item, decision);
    await reload();
    setDecidingId(null);
  }

  function handleClick(item: DecisionItem, decision: 'approved' | 'rejected') {
    if (isHighRisk(item)) { setConfirmTarget({ item, decision }); return; }
    execute(item, decision); // low/medium risk — the click itself is the single confirmation
  }

  const visible = limit ? items.slice(0, limit) : items;
  const confirmItem = confirmTarget?.item;
  const confirmIsCritical = confirmItem ? isCriticalFinancial(confirmItem) : false;
  const alternatives = confirmItem?.source === 'approvals' ? (confirmItem.payload?.rejected_alternatives || []) : [];

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-lg font-semibold">Decision Center</h2>
              <p className="text-xs text-slate-500 mt-0.5">Every real item awaiting your yes/no — approvals and risk-flagged agent directives, unified. Invoice approvals stay on Approvals; uploaded work stays on Project Review — different action shapes, not folded in here.</p>
            </div>
          </div>
          <button onClick={reload} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
      )}

      {error && <div className="bg-red-950/50 border border-red-900 rounded-xl p-3 text-xs text-red-300">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-24"><Loader2 className="w-5 h-5 text-slate-500 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing awaiting your decision right now.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => {
            const key = `${item.source}-${item.id}`;
            const amount = item.source === 'approvals' ? formatCurrency(item.amount_inr) : null;
            const title = item.source === 'approvals' ? item.action_type : item.source === 'delegation' ? `${item.from_agent} → ${item.to_agent}` : item.raw_request;
            const detail = item.source === 'approvals' ? item.reason : item.source === 'delegation' ? item.task_description : `Department: ${item.department_code || '—'}`;
            const readOnly = item.source === 'request';
            return (
              <div key={key} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{title}{amount ? <span className="text-slate-400 font-normal"> · {amount}</span> : ''}</p>
                    {detail && <p className="text-xs text-slate-400 mt-1">{detail}</p>}
                    <p className="text-[10px] text-slate-600 mt-1">{new Date(item.created_at).toLocaleString()}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${riskTone(item.risk_level)}`}>{item.risk_level}</span>
                </div>
                {readOnly ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500"><Info className="w-3 h-3" /> Informational only — this request type has no wired approve/reject path yet. Manage via AI Company.</p>
                ) : (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => handleClick(item, 'approved')} disabled={decidingId === item.id} className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                      {decidingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Approve
                    </button>
                    <button onClick={() => handleClick(item, 'rejected')} disabled={decidingId === item.id} className="flex items-center gap-1.5 text-xs bg-rose-950 hover:bg-rose-900 text-rose-300 px-3 py-1.5 rounded-lg border border-rose-900 disabled:opacity-50">
                      <XCircle className="w-3 h-3" /> Reject
                    </button>
                    {isHighRisk(item) && <span className="text-[9px] text-amber-500/80 self-center">requires confirmation</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!compact && readOnlyCount > 0 && (
        <p className="text-[10px] text-slate-600">{readOnlyCount} item(s) above are informational-only pending requests — see the note on each card.</p>
      )}

      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <AlertDialogContent className="bg-slate-900 border border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {confirmIsCritical ? 'Critical Financial Decision' : 'Confirm High-Risk Decision'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This is a CEO-level decision, not a routine click. Review before confirming.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmItem && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Situation</p>
                <p className="text-slate-200">{confirmItem.source === 'approvals' ? confirmItem.action_type : confirmItem.source === 'delegation' ? `${confirmItem.from_agent} → ${confirmItem.to_agent}: ${confirmItem.task_description}` : confirmItem.raw_request}</p>
              </div>
              {confirmItem.source === 'approvals' && confirmItem.reason && (
                <div><p className="text-[10px] text-slate-500 uppercase tracking-wider">AI recommendation / reasoning</p><p className="text-slate-300 text-xs">{confirmItem.reason}</p></div>
              )}
              {confirmIsCritical && (
                <div><p className="text-[10px] text-slate-500 uppercase tracking-wider">Financial impact</p><p className="text-amber-300 font-semibold">{formatCurrency((confirmItem as ApprovalItem).amount_inr)}</p></div>
              )}
              {alternatives.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Alternatives considered ({alternatives.length})</p>
                  {alternatives.map((alt, i) => (
                    <p key={i} className="text-xs text-slate-400 py-0.5">· {alt.description} <span className="text-slate-600">(score {alt.score}/10)</span></p>
                  ))}
                </div>
              )}
              <div><p className="text-[10px] text-slate-500 uppercase tracking-wider">Risk level</p><span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${riskTone(confirmItem.risk_level)}`}>{confirmItem.risk_level}</span></div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmTarget?.decision === 'rejected' ? 'bg-rose-700 hover:bg-rose-600 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}
              onClick={() => { if (confirmTarget) execute(confirmTarget.item, confirmTarget.decision); setConfirmTarget(null); }}
            >
              Confirm as Founder — {confirmTarget?.decision === 'rejected' ? 'Reject' : 'Approve'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
