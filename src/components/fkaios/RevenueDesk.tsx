'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { IndianRupee, Plus, Send, Check, X, RefreshCw, AlertTriangle, Trash2, FileText } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE DESK — the mechanism by which ₹5 Cr can become non-zero.
//
// WHY THIS EXISTS (Law 3 — never fixate on a single solution):
// The enterprise fixated on ONE revenue path: cold-outbound to scraped strangers,
// which is blocked on paid contact data. But FKAIOS had a far more basic problem
// that no amount of lead data would fix: it had NO WAY TO BILL ANYONE. Zero
// invoices, zero projects, and no screen capable of creating either. The
// invoice-engine edge function has existed and worked the whole time — draft →
// approve → send — with no interface attached to it.
//
// So even a signed deal with an existing brand (Mr. Chick'n, GoMax, Turning
// Points, Gio Paints…) could not be converted into a rupee inside this system.
// The revenue gate had no mechanism. This is the mechanism.
//
// MONEY DISCIPLINE (unchanged, non-negotiable):
//   AI drafts. The Founder approves. Only then is anything sent.
//   Nothing here auto-sends. Nothing here fabricates an amount.
// ─────────────────────────────────────────────────────────────────────────────

interface LineItem { description: string; quantity: number; unit_price_inr: number; }
interface Invoice {
  id: string; invoice_number: string; client_name: string; client_email: string | null;
  line_items: LineItem[]; subtotal_inr: number; tax_inr: number; total_inr: number;
  status: string; amount_received_inr: number | null; created_at: string; company_id: string;
  company?: { name: string } | null;
}
interface Company { id: string; name: string; company_type: string | null; }

const STATUS_TONE: Record<string, string> = {
  draft: 'text-slate-400 bg-slate-800 border-slate-700',
  pending_approval: 'text-amber-300 bg-amber-950/40 border-amber-900',
  approved: 'text-cyan-300 bg-cyan-950/40 border-cyan-900',
  sent: 'text-blue-300 bg-blue-950/40 border-blue-900',
  paid: 'text-emerald-300 bg-emerald-950/40 border-emerald-900',
  rejected: 'text-red-300 bg-red-950/40 border-red-900',
};
const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function RevenueDesk() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // draft form — every field is entered by a human or an AI draft; nothing is invented
  const [companyId, setCompanyId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [taxPct, setTaxPct] = useState(18);
  const [items, setItems] = useState<LineItem[]>([{ description: '', quantity: 1, unit_price_inr: 0 }]);

  const callEngine = useCallback(async (body: Record<string, unknown>) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const res = await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/invoice-engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'invoice-engine failed');
    return d;
  }, []);

  const load = useCallback(async () => {
    try {
      const [{ invoices: inv }, comp] = await Promise.all([
        callEngine({ action: 'list' }),
        supabase.from('companies').select('id,name,company_type').order('name'),
      ]);
      setInvoices(inv ?? []);
      setCompanies((comp.data ?? []) as Company[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
    setLoading(false);
  }, [callEngine]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ invoices: inv }, comp] = await Promise.all([
          callEngine({ action: 'list' }),
          supabase.from('companies').select('id,name,company_type').order('name'),
        ]);
        if (!alive) return;
        setInvoices(inv ?? []);
        setCompanies((comp.data ?? []) as Company[]);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load');
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [callEngine]);

  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price_inr) || 0), 0);
  const tax = subtotal * (taxPct / 100);
  const total = subtotal + tax;
  const canDraft = companyId && clientName.trim() && items.some(i => i.description.trim() && i.unit_price_inr > 0);

  const draft = async () => {
    setBusy('draft');
    try {
      await callEngine({
        action: 'draft', company_id: companyId, client_name: clientName.trim(),
        client_email: clientEmail.trim() || null, tax_rate_pct: taxPct,
        line_items: items.filter(i => i.description.trim()),
      });
      setShowNew(false);
      setClientName(''); setClientEmail(''); setItems([{ description: '', quantity: 1, unit_price_inr: 0 }]);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Draft failed'); }
    setBusy(null);
  };

  const act = async (id: string, action: 'approve' | 'reject', send_now = false) => {
    setBusy(id);
    try {
      const r = await callEngine({ action, id, send_now });
      if (action === 'approve' && r?.email && !r.email.sent) {
        // Truth before beauty: if it did not send, say so. Never imply delivery.
        setError(`Invoice approved, but NOT sent — ${r.email.reason}`);
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : `${action} failed`); }
    setBusy(null);
  };

  const totalReceived = invoices.reduce((s, i) => s + Number(i.amount_received_inr || 0), 0);
  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total_inr || 0), 0);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading the revenue desk…</div>;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2">
        <div className="flex items-center gap-2">
          <IndianRupee className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Revenue Desk</h2>
          <span className="text-[10px] text-slate-500">the only surface through which money enters FKAIOS · AI drafts, you approve, then it sends</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300"><RefreshCw className="w-3 h-3" />Refresh</button>
          <button onClick={() => setShowNew(v => !v)} className="flex items-center gap-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-3 py-1.5">
            <Plus className="w-3.5 h-3.5" />New invoice
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-900 rounded-xl px-4 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-amber-500 hover:text-amber-300"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* The two numbers that matter. Zero is shown as zero. */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <p className={`text-2xl font-bold tabular-nums ${totalReceived > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{inr(totalReceived)}</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Received</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-2xl font-bold text-white tabular-nums">{inr(totalInvoiced)}</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Invoiced</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-2xl font-bold text-white tabular-nums">{invoices.length}</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Invoices</p>
        </div>
      </div>

      {showNew && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white">Draft an invoice</p>
          <div className="grid sm:grid-cols-3 gap-2">
            <select value={companyId} onChange={e => setCompanyId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white">
              <option value="">Billing entity…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Client name (real)"
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600" />
            <input value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="Client email (to send)"
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600" />
          </div>

          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input value={it.description} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                placeholder="What are you billing for?" className="col-span-6 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600" />
              <input type="number" min={1} value={it.quantity} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))}
                className="col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" />
              <input type="number" min={0} value={it.unit_price_inr} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, unit_price_inr: Number(e.target.value) } : x))}
                placeholder="₹ unit price" className="col-span-3 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" />
              <button onClick={() => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : items)}
                className="col-span-1 text-slate-600 hover:text-red-400 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}

          <div className="flex items-center gap-3">
            <button onClick={() => setItems([...items, { description: '', quantity: 1, unit_price_inr: 0 }])}
              className="text-[11px] text-cyan-400 hover:text-cyan-300">+ line item</button>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              GST %<input type="number" value={taxPct} onChange={e => setTaxPct(Number(e.target.value))}
                className="w-14 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white" />
            </div>
            <div className="ml-auto text-right">
              <p className="text-[10px] text-slate-500">Subtotal {inr(subtotal)} · GST {inr(Math.round(tax))}</p>
              <p className="text-base font-bold text-white tabular-nums">{inr(Math.round(total))}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button disabled={!canDraft || busy === 'draft'} onClick={draft}
              className="text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg px-4 py-2">
              {busy === 'draft' ? 'Drafting…' : 'Create draft → awaits your approval'}
            </button>
            <p className="text-[10px] text-slate-600">Nothing is sent until you approve it.</p>
          </div>
        </div>
      )}

      {/* Invoice list */}
      {invoices.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-5 py-6 text-center">
          <FileText className="w-7 h-7 text-slate-700 mx-auto mb-2" />
          <p className="text-sm text-slate-300 font-medium">The enterprise has never billed a customer.</p>
          <p className="text-xs text-slate-500 mt-1.5 max-w-lg mx-auto leading-relaxed">
            This is not an empty state waiting for data to arrive — it is the reason revenue is ₹0.
            Until now FKAIOS had no way to issue an invoice at all. It does now.
            The fastest path to a non-zero number is the relationships that already exist
            (Mr. Chick&apos;n, GoMax, Turning Points, Gio Paints, Arofur, Chaat Masters, Chawla Laboratory) —
            not a stranger who has to be found first.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => (
            <div key={inv.id} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-mono text-slate-400">{inv.invoice_number}</span>
                <span className="text-sm font-semibold text-white">{inv.client_name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${STATUS_TONE[inv.status] ?? 'text-slate-400 bg-slate-800 border-slate-700'}`}>
                  {inv.status.replace('_', ' ')}
                </span>
                <span className="ml-auto text-base font-bold text-white tabular-nums">{inr(inv.total_inr)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {(inv.line_items ?? []).map(li => li.description).filter(Boolean).join(' · ') || 'no line items'}
                {inv.company?.name ? ` — billed by ${inv.company.name}` : ''}
              </p>
              {(inv.status === 'pending_approval' || inv.status === 'draft') && (
                <div className="flex items-center gap-2 mt-2">
                  <button disabled={busy === inv.id} onClick={() => act(inv.id, 'approve', true)}
                    className="flex items-center gap-1 text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white rounded-lg px-2.5 py-1">
                    <Send className="w-3 h-3" />Approve &amp; send
                  </button>
                  <button disabled={busy === inv.id} onClick={() => act(inv.id, 'approve', false)}
                    className="flex items-center gap-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg px-2.5 py-1">
                    <Check className="w-3 h-3" />Approve only
                  </button>
                  <button disabled={busy === inv.id} onClick={() => act(inv.id, 'reject')}
                    className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 rounded-lg px-2 py-1">
                    <X className="w-3 h-3" />Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-slate-600 text-center">
        AI never moves money. It drafts; you approve; only then does anything leave this building.
      </p>
    </div>
  );
}
