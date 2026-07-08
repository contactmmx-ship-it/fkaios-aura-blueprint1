'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Film, Upload, Loader2, X, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

interface VideoRequest {
  id: string;
  product_name: string;
  category: string | null;
  status: string;
  error_message: string | null;
  photo_paths: string[];
  created_at: string;
}

const CATEGORIES = ['Dental Instruments', 'Orthodontic Supplies', 'Restorative Materials', 'Sterilization Equipment', 'Dental Chairs & Equipment', 'Consumables', 'Other'];

const STATUS_LABEL: Record<string, { label: string; color: string; icon: any }> = {
  submitted: { label: 'Submitted', color: 'bg-slate-700 text-slate-300', icon: Clock },
  pending_3d_generation: { label: 'Queued for 3D generation', color: 'bg-blue-500/20 text-blue-400', icon: Clock },
  generating_3d: { label: 'Generating 3D model', color: 'bg-amber-500/20 text-amber-400', icon: Loader2 },
  generating_video: { label: 'Rendering video', color: 'bg-amber-500/20 text-amber-400', icon: Loader2 },
  ready: { label: 'Ready', color: 'bg-emerald-500/20 text-emerald-400', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-500/20 text-red-400', icon: AlertTriangle },
  blocked_no_api_key: { label: 'Blocked — no Meshy.ai key', color: 'bg-rose-500/20 text-rose-400', icon: AlertTriangle },
};

export default function ProductVideoGenerator() {
  const [requests, setRequests] = useState<VideoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [brand, setBrand] = useState('');
  const [feature1, setFeature1] = useState('');
  const [feature2, setFeature2] = useState('');
  const [feature3, setFeature3] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('product_video_requests').select('*').order('created_at', { ascending: false });
    setRequests((data as VideoRequest[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    const arr = Array.from(newFiles).slice(0, 6 - files.length);
    setFiles((prev) => [...prev, ...arr].slice(0, 6));
  }
  function removeFile(i: number) { setFiles((prev) => prev.filter((_, idx) => idx !== i)); }

  async function submit() {
    if (!productName.trim() || files.length === 0) { setError('Product name and at least one photo are required.'); return; }
    if (!feature1.trim() || !feature2.trim()) { setError('Key Feature 1 and 2 are required.'); return; }
    setSubmitting(true); setError(null);
    try {
      const paths: string[] = [];
      for (const f of files) {
        const path = `${Date.now()}-${f.name}`;
        const { error: upErr } = await supabase.storage.from('product-video-photos').upload(path, f);
        if (upErr) throw upErr;
        paths.push(path);
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/product-video-engine', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'submit_request', client_name: 'Dental Kart', product_name: productName, category, brand: brand || null,
          key_feature_1: feature1, key_feature_2: feature2, key_feature_3: feature3 || null, price: price || null, photo_paths: paths,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      setProductName(''); setBrand(''); setFeature1(''); setFeature2(''); setFeature3(''); setPrice(''); setFiles([]);
      setShowForm(false);
      await load();
      if (data.status === 'blocked_no_api_key') setError(data.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Film className="w-5 h-5 text-blue-400" />
          <div>
            <h2 className="text-lg font-semibold">Dental Kart — Product Video Generator</h2>
            <p className="text-xs text-slate-500 mt-0.5">Turn product photos into 3D showcase videos.</p>
          </div>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg">🎬 Generate Product Video</button>
      </div>

      {showForm && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">Product Photos (1-6, JPG/PNG/WEBP, max 20MB each)</p>
            <div className="border-2 border-dashed border-slate-700 rounded-xl p-4">
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => addFiles(e.target.files)} className="text-xs text-slate-400" />
              <div className="flex flex-wrap gap-2 mt-3">
                {files.map((f, i) => (
                  <div key={i} className="relative w-16 h-16 bg-slate-800 rounded-lg flex items-center justify-center">
                    <span className="text-[9px] text-slate-400 px-1 text-center truncate">{f.name}</span>
                    <button onClick={() => removeFile(i)} className="absolute -top-1.5 -right-1.5 bg-rose-600 rounded-full p-0.5"><X className="w-2.5 h-2.5 text-white" /></button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">✓ Best results: white/neutral background · ✓ Include front, side, top views</p>
            </div>
          </div>

          <input value={productName} onChange={(e) => setProductName(e.target.value)} maxLength={60} placeholder="Product Name *" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          <div className="grid grid-cols-2 gap-3">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand (e.g. Hu-Friedy, GC, 3M)" className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={feature1} onChange={(e) => setFeature1(e.target.value)} maxLength={35} placeholder="Key Feature 1 *" className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input value={feature2} onChange={(e) => setFeature2(e.target.value)} maxLength={35} placeholder="Key Feature 2 *" className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={feature3} onChange={(e) => setFeature3(e.target.value)} maxLength={35} placeholder="Key Feature 3 (optional)" className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (optional)" className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>

          {error && <p className="text-xs text-amber-400 bg-amber-950/30 border border-amber-900 rounded-lg px-3 py-2">{error}</p>}
          <button onClick={submit} disabled={submitting} className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Submit
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-slate-500 animate-spin" /></div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-slate-500">No requests yet.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const s = STATUS_LABEL[r.status] || STATUS_LABEL.submitted;
            const Icon = s.icon;
            return (
              <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{r.product_name}</p>
                  <p className="text-xs text-slate-500">{r.category} · {r.photo_paths.length} photo(s)</p>
                  {r.error_message && <p className="text-[11px] text-amber-500 mt-1">{r.error_message}</p>}
                </div>
                <span className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full ${s.color}`}><Icon className="w-3 h-3" /> {s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
