'use client';
import { useState, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// /products — AURA TECH'S SECOND FRONT DOOR.
//
// /franchise serves franchisees. This serves BUSINESSES who want the software —
// white-label or as a build. "Never depend on a single revenue channel."
//
// Every product listed is REAL and SHIPPED — it comes from product_library, whose
// schema physically refuses an asset without evidence (CHECK on the evidence
// column). Nothing here is a mockup or a roadmap item dressed up as inventory.
//
// NO PRICES ARE SHOWN. Pricing is a Founder Approval Gate. The page asks the buyer
// for their budget instead of asserting a fee — which is also the honest thing:
// we do not know what this is worth to them yet.
//
// Enquiries land in the SAME pipeline as franchise leads: lead-capture → BANT
// qualifier → proposal-engine → Founder pricing gate. One funnel, two doors.
// ─────────────────────────────────────────────────────────────────────────────

const FN = 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1';

interface Product { name: string; category: string; what_it_does: string; sellable_as: string | null; target_buyer: string | null; }

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    contact_name: '', contact_phone: '', contact_email: '',
    city: '', brand: '', investment_capacity: '', timeline: '', note: '',
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${FN}/products-public`);
        const d = await r.json();
        if (alive && Array.isArray(d.products)) setProducts(d.products);
      } catch { /* form still works without the catalogue */ }
    })();
    return () => { alive = false; };
  }, []);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${FN}/lead-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          investment_capacity: Number(String(form.investment_capacity).replace(/\D/g, '')),
          note: `[AURA TECH — SOFTWARE ENQUIRY] ${form.brand ? `Interested in: ${form.brand}. ` : ''}${form.note}`,
        }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error || 'Something went wrong. Please try again.');
      else setSent(d.message || 'Thank you — your enquiry has been recorded.');
    } catch {
      setError('Could not reach the server. Please check your connection and try again.');
    }
    setBusy(false);
  };

  if (sent) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-cyan-500/15 border border-cyan-700 flex items-center justify-center mx-auto mb-4">
            <span className="text-cyan-400 text-xl">✓</span>
          </div>
          <h1 className="text-xl font-semibold text-white">Enquiry received</h1>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">{sent}</p>
        </div>
      </main>
    );
  }

  const grouped = products.reduce<Record<string, Product[]>>((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p); return acc;
  }, {});

  return (
    <main className="min-h-screen bg-slate-950 py-12 px-5">
      <div className="max-w-2xl mx-auto">
        <header className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-500/80">Aura Tech</p>
          <h1 className="text-2xl font-semibold text-white mt-2">Enterprise software, already built</h1>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">
            These are systems we run in production ourselves — not mockups, not concepts. Available
            white-label, as modules, or built to your requirement. Tell us what you need and we&apos;ll
            come back with scope and a price.
          </p>
        </header>

        {Object.entries(grouped).map(([category, items]) => (
          <section key={category} className="mb-6">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{category}</p>
            <div className="grid gap-2">
              {items.map(p => (
                <button key={p.name} onClick={() => set('brand', p.name)}
                  className={`text-left rounded-xl border px-4 py-3 transition ${
                    form.brand === p.name ? 'border-cyan-600 bg-cyan-950/25' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                    {p.sellable_as && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-cyan-300 uppercase tracking-wide">{p.sellable_as}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug mt-1">{p.what_it_does}</p>
                  {p.target_buyer && <p className="text-[10px] text-slate-600 mt-1">For: {p.target_buyer}</p>}
                </button>
              ))}
            </div>
          </section>
        ))}

        <div className="space-y-3 mt-8 border-t border-slate-800 pt-6">
          <h2 className="text-sm font-semibold text-white">Tell us what you need</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <F label="Your name *" v={form.contact_name} on={v => set('contact_name', v)} p="Full name" />
            <F label="Mobile number *" v={form.contact_phone} on={v => set('contact_phone', v)} p="10-digit mobile" />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <F label="Work email" v={form.contact_email} on={v => set('contact_email', v)} p="you@company.com" />
            <F label="City *" v={form.city} on={v => set('city', v)} p="e.g. Panipat" />
          </div>
          <F label="Budget for this (₹) *" v={form.investment_capacity} on={v => set('investment_capacity', v)} p="e.g. 500000" />
          <p className="text-[11px] text-slate-500 -mt-1">
            We don&apos;t publish prices, because the honest answer is that it depends on your scope.
            Tell us your budget and we&apos;ll tell you plainly what is and isn&apos;t possible within it.
          </p>
          <F label="When do you need it?" v={form.timeline} on={v => set('timeline', v)} p="e.g. within 90 days" />
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">What are you trying to solve?</label>
            <textarea value={form.note} onChange={e => set('note', e.target.value)} rows={3}
              placeholder="The problem, the users, what exists today…"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-700 focus:outline-none" />
          </div>

          {error && (
            <div className="rounded-xl border border-amber-900 bg-amber-950/40 px-4 py-2.5">
              <p className="text-xs text-amber-200">{error}</p>
            </div>
          )}

          <button onClick={submit} disabled={busy}
            className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-semibold rounded-xl py-3">
            {busy ? 'Sending…' : 'Send enquiry'}
          </button>
          <p className="text-[10px] text-slate-600 text-center">
            Fields marked * are required. We use your details only to respond to this enquiry.
          </p>
        </div>
      </div>
    </main>
  );
}

function F({ label, v, on, p }: { label: string; v: string; on: (x: string) => void; p?: string }) {
  return (
    <div>
      <label className="text-[11px] text-slate-400 block mb-1">{label}</label>
      <input value={v} onChange={e => on(e.target.value)} placeholder={p}
        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-700 focus:outline-none" />
    </div>
  );
}
