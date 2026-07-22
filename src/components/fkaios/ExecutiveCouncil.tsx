'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Gavel, Loader2, RefreshCw, CheckCircle2, XCircle, History } from 'lucide-react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';

// EXECUTIVE COUNCIL — a founder-facing view of executive-brain's adversarial
// board. Read-only from executive_recommendations (no new tables, no
// backend changes). executive-brain runs 6 personas — CFO, CRO, CTO, COO,
// CMO, CPO — deliberately forced to disagree rather than reach consensus;
// this screen is the first surface that's ever shown a founder that debate.
//
// Status actions (Accept/Reject) write directly to the real status column,
// which already has a CHECK constraint permitting proposed/accepted/
// rejected/superseded — so the write itself is safe and schema-native.
// Honestly noted: as of this audit, nothing downstream currently reads
// this status back into a future executive-brain cycle — accepting or
// rejecting records the founder's call, it does not (yet) change what the
// board argues next time. Not overstated here, same discipline as
// DecisionCenter's read-only orchestrator_requests notice.

interface Recommendation {
  id: string;
  exec_role: string;
  mandate: string | null;
  recommendation: string;
  observed_evidence: string | null;
  conflicts_with: string | null;
  conflict_summary: string | null;
  urgency: string;
  confidence_pct: number;
  blocked_by: string | null;
  status: string;
  created_at: string;
}

const SEAT_ORDER = ['CFO', 'CRO', 'CTO', 'COO', 'CMO', 'CPO'];
const seatTitle: Record<string, string> = {
  CFO: 'Chief Financial Officer', CRO: 'Chief Revenue Officer', CTO: 'Chief Technology Officer',
  COO: 'Chief Operating Officer', CMO: 'Chief Marketing Officer', CPO: 'Chief Product Officer',
};
const urgencyTone: Record<string, string> = {
  now: 'bg-red-500/20 text-red-400 border-red-900',
  this_quarter: 'bg-amber-500/20 text-amber-400 border-amber-900',
  strategic: 'bg-slate-800 text-slate-400 border-slate-700',
};
const statusTone: Record<string, string> = {
  proposed: 'text-slate-400', accepted: 'text-emerald-400', rejected: 'text-red-400', superseded: 'text-slate-600',
};

export default function ExecutiveCouncil() {
  const [latest, setLatest] = useState<Record<string, Recommendation>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ rec: Recommendation; decision: 'accepted' | 'rejected' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // No DISTINCT ON over the JS client — fetch a recent window and reduce
    // to the latest sitting per seat client-side. A board meeting shows the
    // current session, not the full historical transcript.
    const { data, error: qErr } = await supabase
      .from('executive_recommendations')
      .select('id, exec_role, mandate, recommendation, observed_evidence, conflicts_with, conflict_summary, urgency, confidence_pct, blocked_by, status, created_at')
      .order('created_at', { ascending: false })
      .limit(120);
    if (qErr) { setError(qErr.message); setLoading(false); return; }
    const byRole: Record<string, Recommendation> = {};
    for (const row of (data || []) as Recommendation[]) {
      if (!byRole[row.exec_role]) byRole[row.exec_role] = row;
    }
    setLatest(byRole);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function execute(rec: Recommendation, decision: 'accepted' | 'rejected') {
    setDecidingId(rec.id);
    await supabase.from('executive_recommendations').update({ status: decision }).eq('id', rec.id);

    // FOUNDER DECISION MEMORY LOOP: same record_enterprise_memory() RPC and
    // shape as DecisionCenter.tsx — best-effort, never blocks the ruling
    // above (which has already succeeded by this point).
    try {
      const outcome = decision === 'accepted' ? `Accepted — ruled in favor of ${rec.exec_role}` : `Rejected — ${rec.exec_role} overruled`;
      await supabase.rpc('record_enterprise_memory', {
        p_source_department: 'EXECUTIVE',
        p_memory_type: 'decision',
        p_title: `${rec.exec_role} recommendation ruling`.slice(0, 200),
        p_content: `Executive Council ruling on the ${rec.exec_role}'s recommendation (urgency: ${rec.urgency}, confidence ${rec.confidence_pct}%). Original: "${rec.recommendation}". Founder ruling: ${decision}. Outcome: ${outcome}.`.slice(0, 2000),
        p_structured: {
          source: 'executive-council',
          exec_role: rec.exec_role,
          founder_ruling: decision,
          decision_outcome: outcome,
          // executive_recommendations has no distinct risk_level column —
          // urgency (now/this_quarter/strategic) is the closest real analog.
          risk_level: rec.urgency,
          original_recommendation: rec.recommendation,
          conflicts_with: rec.conflicts_with,
        },
        p_confidence: 1.0,
        p_visible_departments: ['*'],
      });
    } catch (err) {
      console.error('Founder Decision Memory Loop: record_enterprise_memory failed (non-blocking)', err);
    }

    await load();
    setDecidingId(null);
  }

  function handleClick(rec: Recommendation, decision: 'accepted' | 'rejected') {
    setConfirmTarget({ rec, decision }); // every boardroom call gets a confirmation — this is a founder ruling, not a click
  }

  const seats = SEAT_ORDER.map(role => latest[role]).filter(Boolean) as Recommendation[];
  const missingSeats = SEAT_ORDER.filter(role => !latest[role]);
  const sessionDate = seats.length > 0 ? new Date(Math.max(...seats.map(s => new Date(s.created_at).getTime()))) : null;

  if (loading) return <div className="p-6 text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Convening the Executive Council…</div>;
  if (error) return <div className="m-6 bg-red-950/40 border border-red-900 rounded-xl px-4 py-3 text-xs text-red-300">Executive Council error: {error}</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-orange-500 flex items-center justify-center shrink-0"><Gavel className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-lg font-bold text-white">Executive Council</h1>
            <p className="text-xs text-slate-500 mt-0.5">Six executives, deliberately never in consensus. {sessionDate ? `In session ${sessionDate.toLocaleString()}` : 'No session recorded yet'}.</p>
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      {seats.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-6 text-center text-sm text-slate-500">The Council has not convened yet — executive-brain runs once daily; check back after its next cycle.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {seats.map((rec) => (
            <div key={rec.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
                <div>
                  <p className="text-sm font-bold text-white">{rec.exec_role}</p>
                  <p className="text-[10px] text-slate-500">{seatTitle[rec.exec_role] || rec.exec_role}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${urgencyTone[rec.urgency] || urgencyTone.strategic}`}>{rec.urgency.replace('_', ' ')}</span>
                  <span className="text-[10px] text-slate-400 tabular-nums">{rec.confidence_pct}% confidence</span>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-sm text-slate-200 leading-relaxed">{rec.recommendation}</p>
                {rec.observed_evidence && (
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Evidence</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{rec.observed_evidence}</p>
                  </div>
                )}
                {rec.conflicts_with && rec.conflict_summary && (
                  <div className="bg-red-950/20 border border-red-900/40 rounded-lg px-3 py-2.5">
                    <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1">Conflicts with {rec.conflicts_with}</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{rec.conflict_summary}</p>
                  </div>
                )}
                {rec.blocked_by && <p className="text-[10px] text-amber-400/80">Blocked by: {rec.blocked_by}</p>}

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/70">
                  {rec.status === 'proposed' ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleClick(rec, 'accepted')} disabled={decidingId === rec.id} className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                        {decidingId === rec.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Rule in favor
                      </button>
                      <button onClick={() => handleClick(rec, 'rejected')} disabled={decidingId === rec.id} className="flex items-center gap-1.5 text-xs bg-rose-950 hover:bg-rose-900 text-rose-300 px-3 py-1.5 rounded-lg border border-rose-900 disabled:opacity-50">
                        <XCircle className="w-3 h-3" /> Overrule
                      </button>
                    </div>
                  ) : (
                    <span className={`text-xs font-semibold uppercase ${statusTone[rec.status]}`}>Founder ruling: {rec.status}</span>
                  )}
                  <span className="text-[9px] text-slate-600 flex items-center gap-1"><History className="w-3 h-3" />{new Date(rec.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {missingSeats.length > 0 && (
        <p className="text-[10px] text-slate-600">No recent statement on record from: {missingSeats.join(', ')}.</p>
      )}
      <p className="text-[10px] text-slate-600">Ruling on a statement records your decision on this recommendation. It does not yet feed back into the Council's next session — that loop isn't built.</p>

      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <AlertDialogContent className="bg-slate-900 border border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {confirmTarget?.decision === 'accepted' ? 'Rule in favor of' : 'Overrule'} the {confirmTarget?.rec.exec_role}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This is a founder ruling on a boardroom recommendation, not a routine click.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmTarget && (
            <div className="space-y-2 text-sm">
              <p className="text-slate-200">{confirmTarget.rec.recommendation}</p>
              {confirmTarget.rec.conflicts_with && <p className="text-xs text-slate-500">Conflicts with: {confirmTarget.rec.conflicts_with}</p>}
              <p className="text-xs text-slate-500">Confidence: {confirmTarget.rec.confidence_pct}% · Urgency: {confirmTarget.rec.urgency.replace('_', ' ')}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmTarget?.decision === 'rejected' ? 'bg-rose-700 hover:bg-rose-600 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}
              onClick={() => { if (confirmTarget) execute(confirmTarget.rec, confirmTarget.decision); setConfirmTarget(null); }}
            >
              Confirm Ruling
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
