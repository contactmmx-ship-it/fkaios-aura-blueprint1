'use client';
import { useState, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// /franchise — THE FRONT DOOR.
//
// This is the first surface in the history of this enterprise through which a
// customer can reach it. Everything before this was outbound: FKAIOS scraping
// Google results that had no phone number and no budget, and therefore could
// never clear the BANT bar of 40 (proven: best score ever = 32).
//
// An inbound enquirer supplies Budget, Authority, Need and Timeline himself.
// That is a lead that can qualify, become a project, become an invoice, and
// become the first rupee against the ₹5 Cr gate.
//
// PUBLIC. No auth. No Supabase client (the anon key is not shipped to strangers
// and the brands table stays RLS-locked) — it talks to two public edge functions
// that expose exactly what a stranger may see, and nothing more.
// ─────────────────────────────────────────────────────────────────────────────

const FN = 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1';

interface Brand { name: string; sector: string | null; type: string | null; investment_range: string | null; }

export default function FranchiseEnquiry() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    contact_name: '', contact_phone: '', contact_email: '',
    city: '', state: '', brand: '', investment_capacity: '', timeline: '', note: '',
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${FN}/brands-public`);
        const d = await r.json();
        if (alive && Array.isArray(d.brands)) setBrands(d.brands);
      } catch { /* the form still works without the brand list */ }
    })();
    return () => { alive = false; };
  }, []);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${FN}/lead-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, investment_capacity: Number(String(form.investment_capacity).replace(/\D/g, '')) }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Something went wrong. Please try again.'); }
      else { setSent(d.message || 'Thank you — your enquiry has been recorded.'); }
    } catch {
      setError('Could not reach the server. Please check your connection and try again.');
    }
    setBusy(false);
  };

  const selected = brands.find(b => b.name === form.brand);

  if (sent) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-700 flex items-center justify-center mx-auto mb-4">
            <span className="text-emerald-400 text-xl">✓</span>
          </div>
          <h1 className="text-xl font-semibold text-white">Enquiry received</h1>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">{sent}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 py-12 px-5">
      <div className="max-w-xl mx-auto">
        <header className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-amber-500/80">Franchise Kart</p>
          <h1 className="text-2xl font-semibold text-white mt-2">Enquire about a franchise</h1>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">
            Tell us which brand interests you and what you&apos;re able to invest. Our team reviews every
            enquiry and will contact you directly — we only take this forward if the opportunity genuinely fits you.
          </p>
        </header>

        {brands.length > 0 && (
          <div className="mb-6 grid gap-2">
            {brands.map(b => (
              <button key={b.name} onClick={() => set('brand', b.name)}
                className={`text-left rounded-xl border px-4 py-3 transition ${
                  form.brand === b.name
                    ? 'border-amber-600 bg-amber-950/30'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white">{b.name}</span>
                  {b.sector && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{b.sector}</span>}
                  {b.investment_range && <span className="ml-auto text-xs text-slate-400 tabular-nums">₹{b.investment_range}</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Your name *" value={form.contact_name} onChange={v => set('contact_name', v)} placeholder="Full name" />
            <Field label="Mobile number *" value={form.contact_phone} onChange={v => set('contact_phone', v)} placeholder="10-digit mobile" />
          </div>
          <Field label="Email" value={form.contact_email} onChange={v => set('contact_email', v)} placeholder="you@example.com" />
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="City *" value={form.city} onChange={v => set('city', v)} placeholder="e.g. Kurukshetra" />
            <Field label="State" value={form.state} onChange={v => set('state', v)} placeholder="e.g. Haryana" />
          </div>
          <Field label="Investment capacity (₹) *" value={form.investment_capacity}
            onChange={v => set('investment_capacity', v)} placeholder="e.g. 2500000" />
          {selected?.investment_range && (
            <p className="text-[11px] text-slate-500 -mt-1">
              {selected.name} typically requires ₹{selected.investment_range}. Please tell us your real figure — an honest
              number helps us recommend the right brand rather than the wrong one.
            </p>
          )}
          <Field label="When are you looking to start?" value={form.timeline}
            onChange={v => set('timeline', v)} placeholder="e.g. within 60 days" />
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Anything else we should know?</label>
            <textarea value={form.note} onChange={e => set('note', e.target.value)} rows={3}
              placeholder="Location you have in mind, existing business, prior experience…"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-amber-700 focus:outline-none" />
          </div>

          {error && (
            <div className="rounded-xl border border-amber-900 bg-amber-950/40 px-4 py-2.5">
              <p className="text-xs text-amber-200">{error}</p>
            </div>
          )}

          <button onClick={submit} disabled={busy}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-semibold rounded-xl py-3 mt-1">
            {busy ? 'Sending…' : 'Submit enquiry'}
          </button>
          <p className="text-[10px] text-slate-600 text-center">
            Fields marked * are required. We use your details only to contact you about this enquiry.
          </p>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[11px] text-slate-400 block mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-amber-700 focus:outline-none" />
    </div>
  );
}
