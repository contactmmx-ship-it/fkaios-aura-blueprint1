'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface Company {
  id: string; name: string; legal_name: string | null; company_type: 'holding' | 'subsidiary';
  parent_company_id: string | null; sector: string | null; status: 'shell' | 'active' | 'paused';
  description: string | null;
}
interface BankAccount {
  id: string; company_id: string; account_holder_name: string; bank_name: string;
  account_number: string; ifsc_code: string | null; branch: string | null; is_primary: boolean;
}
interface KycDoc {
  id: string; company_id: string; document_type: string; file_name: string; signed_url: string | null; uploaded_at: string;
}

const DOC_TYPES = [
  { value: 'cancelled_cheque', label: 'Cancelled Cheque' },
  { value: 'passbook', label: 'Passbook' },
  { value: 'pan_card', label: 'PAN Card' },
  { value: 'gst_certificate', label: 'GST Certificate' },
  { value: 'incorporation_certificate', label: 'Incorporation Certificate' },
  { value: 'other', label: 'Other' },
];

const STATUS_COLOR: Record<string, string> = {
  active: 'text-emerald-400 bg-emerald-500/10',
  shell: 'text-amber-400 bg-amber-500/10',
  paused: 'text-slate-400 bg-slate-500/10',
};

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export default function CompaniesAdmin() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<Company | null>(null);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [docs, setDocs] = useState<KycDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [showNewBank, setShowNewBank] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const call = async (resource: string, action: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('company-admin-engine', { body: { resource, action, ...extra } });
    if (error || data?.error) throw new Error(data?.error || error?.message || 'Request failed');
    return data;
  };

  const loadCompanies = useCallback(async () => {
    try {
      const data = await call('companies', 'list');
      setCompanies(data.companies ?? []);
      if (data.companies?.length && !selected) setSelected(data.companies.find((c: Company) => c.company_type === 'subsidiary') ?? data.companies[0]);
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed to load companies', error: true }); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCompanyDetail = useCallback(async (companyId: string) => {
    try {
      const [b, d] = await Promise.all([call('bank_accounts', 'list', { company_id: companyId }), call('kyc_documents', 'list', { company_id: companyId })]);
      setBanks(b.bank_accounts ?? []); setDocs(d.kyc_documents ?? []);
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Failed to load company detail', error: true }); }
  }, []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { if (selected) loadCompanyDetail(selected.id); }, [selected, loadCompanyDetail]);

  const updateCompanyStatus = async (id: string, status: string) => {
    try { await call('companies', 'update', { id, status }); await loadCompanies(); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Update failed', error: true }); }
  };

  const deleteCompany = async (id: string) => {
    if (!confirm('Delete this company? This also deletes its bank accounts and KYC documents. This cannot be undone.')) return;
    try { await call('companies', 'delete', { id }); setSelected(null); await loadCompanies(); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Delete failed', error: true }); }
  };

  const deleteBank = async (id: string) => {
    if (!confirm('Delete this bank account?')) return;
    try { await call('bank_accounts', 'delete', { id }); if (selected) loadCompanyDetail(selected.id); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Delete failed', error: true }); }
  };

  const deleteDoc = async (id: string) => {
    if (!confirm('Delete this document?')) return;
    try { await call('kyc_documents', 'delete', { id }); if (selected) loadCompanyDetail(selected.id); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Delete failed', error: true }); }
  };

  const uploadDoc = async (file: File, documentType: string) => {
    if (!selected) return;
    setUploading(true); setMsg(null);
    try {
      const base64 = await fileToBase64(file);
      await call('kyc_documents', 'upload', { company_id: selected.id, document_type: documentType, file_name: file.name, file_base64: base64 });
      setMsg({ text: `${file.name} uploaded.` });
      await loadCompanyDetail(selected.id);
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Upload failed', error: true }); }
    setUploading(false);
  };

  if (loading) return <div className="text-sm text-slate-500 p-6">Loading companies…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-white">Companies</h1>
          <span className="text-[10px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full">Bhavishya Associates Group</span>
        </div>
        <button onClick={() => setShowNewCompany(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg">+ Add Company</button>
      </div>
      {msg && <p className={`text-xs ${msg.error ? 'text-rose-400' : 'text-emerald-400'}`}>{msg.text}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Company list */}
        <div className="lg:col-span-1 space-y-2">
          {companies.map((c) => (
            <button key={c.id} onClick={() => setSelected(c)}
              className={`w-full text-left p-3 bg-slate-900 border rounded-xl transition-colors ${selected?.id === c.id ? 'border-blue-500/50' : 'border-slate-800 hover:border-slate-700'}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{c.name}</p>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_COLOR[c.status]}`}>{c.status}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">{c.company_type === 'holding' ? 'Holding company' : c.sector ?? 'Subsidiary'}</p>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3 space-y-4">
          {selected ? (
            <>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-bold text-white">{selected.name}</h2>
                    <p className="text-xs text-slate-500 mt-1">{selected.description}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <select value={selected.status} onChange={(e) => updateCompanyStatus(selected.id, e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-xs text-white rounded-lg px-2 py-1.5">
                      <option value="active">Active</option>
                      <option value="shell">Shell</option>
                      <option value="paused">Paused</option>
                    </select>
                    <button onClick={() => deleteCompany(selected.id)} className="px-2 py-1.5 bg-rose-600/20 border border-rose-500/30 text-rose-400 text-xs rounded-lg hover:bg-rose-600/30">Delete</button>
                  </div>
                </div>
              </div>

              {/* Bank accounts */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Bank Accounts</p>
                  <button onClick={() => setShowNewBank(true)} className="text-xs text-blue-400 hover:text-blue-300">+ Add Account</button>
                </div>
                {banks.length === 0 ? <p className="text-xs text-slate-600 italic">No bank account on file yet.</p> : (
                  <div className="space-y-2">
                    {banks.map((b) => (
                      <div key={b.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                        <div>
                          <p className="text-xs text-white">{b.bank_name} — {b.account_number.replace(/(?=.{4})/g, '•').slice(-8)}</p>
                          <p className="text-[10px] text-slate-500">{b.account_holder_name} · {b.ifsc_code ?? 'No IFSC'} {b.is_primary && <span className="text-emerald-400 ml-1">Primary</span>}</p>
                        </div>
                        <button onClick={() => deleteBank(b.id)} className="text-[10px] text-rose-400 hover:text-rose-300">Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* KYC documents */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">KYC Documents — Cancelled Cheque, Passbook, etc.</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {DOC_TYPES.map((dt) => (
                    <label key={dt.value} className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-[11px] text-slate-300 hover:border-blue-500/40 cursor-pointer">
                      {uploading ? 'Uploading…' : `Upload ${dt.label}`}
                      <input type="file" accept="image/*,.pdf" className="hidden" disabled={uploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f, dt.value); e.target.value = ''; }} />
                    </label>
                  ))}
                </div>
                {docs.length === 0 ? <p className="text-xs text-slate-600 italic">No documents uploaded yet.</p> : (
                  <div className="space-y-2">
                    {docs.map((d) => (
                      <div key={d.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                        <div>
                          <p className="text-xs text-white">{DOC_TYPES.find((t) => t.value === d.document_type)?.label ?? d.document_type}</p>
                          <p className="text-[10px] text-slate-500">{d.file_name} · {new Date(d.uploaded_at).toLocaleDateString()}</p>
                        </div>
                        <div className="flex gap-3 items-center">
                          {d.signed_url && <a href={d.signed_url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300">View</a>}
                          <button onClick={() => deleteDoc(d.id)} className="text-[10px] text-rose-400 hover:text-rose-300">Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : <p className="text-sm text-slate-500">Select a company to view details.</p>}
        </div>
      </div>

      {showNewCompany && <NewCompanyModal companies={companies} onClose={() => setShowNewCompany(false)} onCreated={async () => { setShowNewCompany(false); await loadCompanies(); }} call={call} />}
      {showNewBank && selected && <NewBankModal companyId={selected.id} onClose={() => setShowNewBank(false)} onCreated={async () => { setShowNewBank(false); await loadCompanyDetail(selected.id); }} call={call} />}
    </div>
  );
}

function NewCompanyModal({ companies, onClose, onCreated, call }: { companies: Company[]; onClose: () => void; onCreated: () => void; call: (r: string, a: string, e?: Record<string, unknown>) => Promise<any> }) {
  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState(companies.find((c) => c.company_type === 'holding')?.id ?? '');
  const [status, setStatus] = useState('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      await call('companies', 'create', { name, sector, description, parent_company_id: parentId || null, company_type: 'subsidiary', status });
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to create company'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white">Add Company</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Sector (e.g. Real Estate)" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this company do?" rows={2} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">No parent (standalone)</option>
            {companies.filter((c) => c.company_type === 'holding').map((c) => <option key={c.id} value={c.id}>{c.name} (parent)</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="active">Active</option>
            <option value="shell">Shell (build out later)</option>
          </select>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button onClick={submit} disabled={saving || !name.trim()} className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
            {saving ? 'Creating…' : 'Create Company'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewBankModal({ companyId, onClose, onCreated, call }: { companyId: string; onClose: () => void; onCreated: () => void; call: (r: string, a: string, e?: Record<string, unknown>) => Promise<any> }) {
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [acc, setAcc] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [branch, setBranch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!holder.trim() || !bank.trim() || !acc.trim()) return;
    setSaving(true); setError(null);
    try {
      await call('bank_accounts', 'create', { company_id: companyId, account_holder_name: holder, bank_name: bank, account_number: acc, ifsc_code: ifsc, branch });
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to add bank account'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white">Add Bank Account</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="space-y-3">
          <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Account holder name" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Bank name" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <input value={acc} onChange={(e) => setAcc(e.target.value)} placeholder="Account number" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <input value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="IFSC code" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Branch" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button onClick={submit} disabled={saving || !holder.trim() || !bank.trim() || !acc.trim()} className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
            {saving ? 'Saving…' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
