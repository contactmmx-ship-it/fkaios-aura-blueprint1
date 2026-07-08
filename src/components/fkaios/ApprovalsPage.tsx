'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, Loader2, RefreshCw, CheckCircle2, XCircle, IndianRupee, Bell } from 'lucide-react';

interface PendingInvoice {
  id: string;
  client_name: string;
  total_inr: number | null;
  status: string;
  created_at: string;
}
interface GenericApproval {
  id: string;
  department_code: string;
  action_type: string;
  amount_inr: number | null;
  risk_level: string;
  reason: string | null;
  created_at: string;
}
interface FounderNotification {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  amount_inr: number | null;
  is_read: boolean;
  created_at: string;
}

function formatCurrency(val: number | null) {
  if (val === null || val === undefined) return '—';
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
  return `₹${val.toLocaleString('en-IN')}`;
}

export default function ApprovalsPage() {
  const [invoices, setInvoices] = useState<PendingInvoice[]>([]);
  const [approvals, setApprovals] = useState<GenericApproval[]>([]);
  const [notifications, setNotifications] = useState<FounderNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    const [invRes, apRes, notifRes] = await Promise.all([
      supabase.from('company_invoices').select('id, client_name, total_inr, status, created_at').eq('status', 'pending_approval').order('created_at', { ascending: true }),
      supabase.from('approvals').select('id, department_code, action_type, amount_inr, risk_level, reason, created_at').is('decided_at', null).order('created_at', { ascending: true }),
      supabase.from('founder_notifications').select('id, type, title, detail, amount_inr, is_read, created_at').order('created_at', { ascending: false }).limit(20),
    ]);
    setInvoices((invRes.data as PendingInvoice[]) || []);
    setApprovals((apRes.data as GenericApproval[]) || []);
    setNotifications((notifRes.data as FounderNotification[]) || []);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function decideInvoice(invoiceId: string, decision: 'approved' | 'rejected') {
    setDecidingId(invoiceId);
    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/finance-engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'approve_invoice', invoice_id: invoiceId, decision }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to decide invoice');
      setDecidingId(null);
      return;
    }
    await loadAll();
    setDecidingId(null);
  }

  async function markNotificationRead(id: string) {
    await supabase.from('founder_notifications').update({ is_read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-lg font-semibold">Approvals</h2>
            <p className="text-xs text-slate-500 mt-0.5">Real invoice approvals and governance queue — nothing sends without your decision here.</p>
          </div>
        </div>
        <button onClick={loadAll} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-900 rounded-xl p-3 text-xs text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-5 h-5 text-slate-500 animate-spin" /></div>
      ) : (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">Invoices Awaiting Your Approval ({invoices.length})</h3>
            </div>
            {invoices.length === 0 ? (
              <p className="text-xs text-slate-500 p-5">Nothing pending — every drafted invoice has been decided.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-medium text-white">{inv.client_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{formatCurrency(inv.total_inr)} · filed {new Date(inv.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => decideInvoice(inv.id, 'approved')}
                        disabled={decidingId === inv.id}
                        className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                      >
                        {decidingId === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Approve
                      </button>
                      <button
                        onClick={() => decideInvoice(inv.id, 'rejected')}
                        disabled={decidingId === inv.id}
                        className="flex items-center gap-1.5 text-xs bg-rose-950 hover:bg-rose-900 text-rose-300 px-3 py-1.5 rounded-lg border border-rose-900 disabled:opacity-50"
                      >
                        <XCircle className="w-3 h-3" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Other Governance Approvals ({approvals.length})</h3>
            </div>
            {approvals.length === 0 ? (
              <p className="text-xs text-slate-500 p-5">Nothing pending.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {approvals.map((a) => (
                  <div key={a.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-white">{a.department_code} — {a.action_type}</p>
                      <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${a.risk_level === 'high' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>{a.risk_level}</span>
                    </div>
                    {a.reason && <p className="text-xs text-slate-400 mt-1">{a.reason}</p>}
                    {a.amount_inr && <p className="text-xs text-slate-500 mt-1">{formatCurrency(a.amount_inr)}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Notifications</h3>
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500 p-5">No notifications yet.</p>
            ) : (
              <div className="divide-y divide-slate-800 max-h-96 overflow-y-auto">
                {notifications.map((n) => (
                  <button key={n.id} onClick={() => !n.is_read && markNotificationRead(n.id)} className={`w-full text-left p-4 hover:bg-slate-800/30 ${!n.is_read ? 'bg-blue-500/5' : ''}`}>
                    <div className="flex items-center justify-between">
                      <p className={`text-sm ${!n.is_read ? 'text-white font-medium' : 'text-slate-400'}`}>{n.title}</p>
                      {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
                    </div>
                    {n.detail && <p className="text-xs text-slate-500 mt-1">{n.detail}</p>}
                    <p className="text-[10px] text-slate-600 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
