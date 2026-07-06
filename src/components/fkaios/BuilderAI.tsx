'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Hammer, Globe, Database, Package, Layout, Loader2, CheckCircle, XCircle, ExternalLink, Download, ChevronDown, ChevronUp, Clock } from 'lucide-react';

type BuildType = 'website' | 'landing_page' | 'crm' | 'saas';

interface Brand { id: string; name: string; sector: string | null; }

interface BuildProject {
  id: string; brand_name: string; build_type: BuildType;
  status: 'pending' | 'generating' | 'complete' | 'failed';
  requirements: string; output_html: string | null; output_json: unknown | null;
  deployed_url: string | null; error_message: string | null;
  token_cost: { input: number; output: number; model: string } | null;
  created_at: string;
}

const BUILD_TYPES = [
  { value: 'website' as BuildType, label: 'Website', icon: Globe, description: 'Full brand website — Hero, About, Investment Details, Contact. Self-contained HTML.' },
  { value: 'landing_page' as BuildType, label: 'Landing Page', icon: Layout, description: 'Single-purpose lead capture page for ad campaigns or franchise inquiries.' },
  { value: 'crm' as BuildType, label: 'CRM Module', icon: Database, description: 'Supabase migration SQL + React component tailored to your brand.' },
  { value: 'saas' as BuildType, label: 'SaaS Scaffold', icon: Package, description: 'Next.js + Supabase project scaffold with auth, schema, and core pages.' },
];

export default function BuilderAI() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [customBrandName, setCustomBrandName] = useState('');
  const [buildType, setBuildType] = useState<BuildType>('website');
  const [requirements, setRequirements] = useState('');
  const [building, setBuilding] = useState(false);
  const [currentBuildId, setCurrentBuildId] = useState<string | null>(null);
  const [currentBuild, setCurrentBuild] = useState<BuildProject | null>(null);
  const [history, setHistory] = useState<BuildProject[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadBrands();
    loadHistory();
  }, []);

  useEffect(() => {
    if (!currentBuildId || !building) return;
    pollRef.current = setInterval(async () => {
      const { data } = await supabase.functions.invoke('builder-engine', { body: { action: 'status', build_id: currentBuildId } });
      if (data && (data.status === 'complete' || data.status === 'failed')) {
        clearInterval(pollRef.current!);
        setCurrentBuild(data as BuildProject);
        setBuilding(false);
        loadHistory();
      }
    }, 4000);
    return () => clearInterval(pollRef.current!);
  }, [currentBuildId, building]);

  async function loadBrands() {
    const { data } = await supabase.from('brands').select('id, name, sector').eq('is_active', true).order('name');
    setBrands(data || []);
  }

  async function loadHistory() {
    const { data } = await supabase.functions.invoke('builder-engine', { body: { action: 'list' } });
    setHistory(data?.builds ?? []);
  }

  async function startBuild() {
    if (!requirements.trim()) { setError('Requirements are required.'); return; }
    setError(null); setBuilding(true); setCurrentBuild(null); setPreviewOpen(false);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('builder-engine', {
        body: { action: 'build', build_type: buildType, brand_id: selectedBrand || undefined, brand_name_override: !selectedBrand && customBrandName ? customBrandName : undefined, requirements: requirements.trim() },
      });
      if (invokeErr || data?.error) throw new Error(data?.error || invokeErr?.message || 'Build failed');
      if (data.status === 'complete') {
        const { data: full } = await supabase.functions.invoke('builder-engine', { body: { action: 'status', build_id: data.build_id } });
        setCurrentBuild(full ?? data); setBuilding(false); loadHistory();
      } else { setCurrentBuildId(data.build_id); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Build failed'); setBuilding(false); }
  }

  function downloadHtml(build: BuildProject) {
    if (!build.output_html) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([build.output_html], { type: 'text/html' }));
    a.download = `${build.brand_name.toLowerCase().replace(/\s+/g, '-')}-${build.build_type}.html`;
    a.click();
  }

  function downloadJson(build: BuildProject) {
    if (!build.output_json) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(build.output_json, null, 2)], { type: 'application/json' }));
    a.download = `${build.brand_name.toLowerCase().replace(/\s+/g, '-')}-${build.build_type}.json`;
    a.click();
  }

  async function deployBuild(build: BuildProject) {
    setDeploying(true); setDeployError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('builder-engine', { body: { action: 'deploy', build_id: build.id } });
      if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message || 'Deploy failed');
      setCurrentBuild(prev => prev && prev.id === build.id ? { ...prev, deployed_url: data.deployed_url } : prev);
      loadHistory();
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  }

  async function generateBrandImage() {
    if (!imagePrompt.trim()) return;
    setGeneratingImage(true); setImageError(null); setGeneratedImage(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('builder-engine', { body: { action: 'generate_image', prompt: imagePrompt } });
      if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message || 'Image generation failed');
      setGeneratedImage({ base64: data.imageBase64, mimeType: data.mimeType });
    } catch (e) {
      setImageError(e instanceof Error ? e.message : 'Image generation failed');
    } finally {
      setGeneratingImage(false);
    }
  }

  function downloadImage() {
    if (!generatedImage) return;
    const a = document.createElement('a');
    a.href = `data:${generatedImage.mimeType};base64,${generatedImage.base64}`;
    a.download = `brand-image-${Date.now()}.png`;
    a.click();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Hammer className="w-5 h-5 text-violet-400" />
        <div>
          <h2 className="text-lg font-semibold">Builder AI — Software Factory</h2>
          <p className="text-xs text-slate-500 mt-0.5">Generates real deployable code using <span className="text-violet-400">claude-3-5-sonnet</span> grounded in your actual brand data.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">What to build</p>
            {BUILD_TYPES.map((bt) => {
              const Icon = bt.icon;
              return (
                <button key={bt.value} onClick={() => setBuildType(bt.value)}
                  className={`w-full text-left p-3 rounded-xl transition-all border ${buildType === bt.value ? 'bg-violet-600/20 border-violet-500/50 text-violet-300' : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:border-slate-600'}`}>
                  <div className="flex items-center gap-2 mb-1"><Icon className="w-4 h-4" /><span className="text-sm font-medium">{bt.label}</span></div>
                  <p className="text-xs text-slate-500">{bt.description}</p>
                </button>
              );
            })}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Brand (optional)</p>
            <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white">
              <option value="">No brand selected</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.sector ? ` — ${b.sector}` : ''}</option>)}
            </select>
            {!selectedBrand && (
              <input placeholder="Brand name (e.g. GoMax, Mr. Chick'n)" value={customBrandName} onChange={(e) => setCustomBrandName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white" />
            )}
            <p className="text-xs text-slate-600">Selecting a real brand feeds actual investment range, royalty %, and sector into the prompt — Claude cannot invent figures it wasn&apos;t given.</p>
          </div>
        </div>

        {/* Right panel */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Requirements</p>
            <textarea rows={6}
              placeholder={buildType === 'website' || buildType === 'landing_page'
                ? 'E.g. "A franchise inquiry landing page with hero section, benefits, fee structure, and a contact form. Dark theme."'
                : buildType === 'crm'
                ? 'E.g. "A CRM for managing paint dealer relationships — track dealer name, city, purchase volume, assigned RM, last visit date."'
                : 'E.g. "A franchisee portal where owners log in, see monthly performance metrics, and submit support tickets."'}
              value={requirements} onChange={(e) => setRequirements(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white resize-none" />
            {error && (
              <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
                <XCircle className="w-4 h-4 shrink-0" />{error}
              </div>
            )}
            <button onClick={startBuild} disabled={building || !requirements.trim()}
              className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/30 disabled:opacity-50 flex items-center justify-center gap-2">
              {building ? <><Loader2 className="w-4 h-4 animate-spin" />Generating with Claude — 15–40 seconds…</> : <><Hammer className="w-4 h-4" />Build with AI</>}
            </button>
            {building && <p className="text-xs text-slate-500 text-center">Real LLM call in progress. Not a spinner over cached output.</p>}
          </div>

          {currentBuild && (
            <div className={`bg-slate-900 border rounded-2xl p-4 space-y-4 ${currentBuild.status === 'complete' ? 'border-emerald-500/30' : 'border-rose-500/30'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {currentBuild.status === 'complete' ? <CheckCircle className="w-5 h-5 text-emerald-400" /> : <XCircle className="w-5 h-5 text-rose-400" />}
                  <span className="font-semibold text-sm">{currentBuild.status === 'complete' ? 'Build complete' : 'Build failed'}</span>
                  <span className="text-xs text-slate-500">{currentBuild.brand_name} — {currentBuild.build_type}</span>
                </div>
                {currentBuild.token_cost && <span className="text-xs text-slate-600">{currentBuild.token_cost.input + currentBuild.token_cost.output} tokens / {currentBuild.token_cost.model}</span>}
              </div>

              {currentBuild.status === 'failed' && (
                <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">{currentBuild.error_message ?? 'Unknown failure'}</p>
              )}

              {currentBuild.status === 'complete' && (
                <div className="space-y-3">
                  {currentBuild.deployed_url && (
                    <a href={currentBuild.deployed_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-sm font-medium rounded-xl hover:bg-emerald-600/30 transition-all w-fit">
                      <ExternalLink className="w-4 h-4" />Live: {currentBuild.deployed_url}
                    </a>
                  )}
                  {deployError && (
                    <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
                      <XCircle className="w-4 h-4 shrink-0" />{deployError}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {currentBuild.output_html && !currentBuild.deployed_url && (
                      <button onClick={() => deployBuild(currentBuild)} disabled={deploying}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all">
                        {deploying ? <><Loader2 className="w-4 h-4 animate-spin" />Deploying to Netlify…</> : <><ExternalLink className="w-4 h-4" />Deploy Live</>}
                      </button>
                    )}
                    {currentBuild.output_html && (
                      <>
                        <button onClick={() => setPreviewOpen(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium rounded-xl hover:bg-slate-700 transition-all">
                          {previewOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{previewOpen ? 'Hide preview' : 'Preview'}
                        </button>
                        <button onClick={() => downloadHtml(currentBuild)} className="flex items-center gap-2 px-4 py-2 bg-violet-600/20 border border-violet-500/30 text-violet-400 text-sm font-medium rounded-xl hover:bg-violet-600/30 transition-all">
                          <Download className="w-4 h-4" />Download HTML
                        </button>
                      </>
                    )}
                    {currentBuild.output_json && (
                      <button onClick={() => downloadJson(currentBuild)} className="flex items-center gap-2 px-4 py-2 bg-violet-600/20 border border-violet-500/30 text-violet-400 text-sm font-medium rounded-xl hover:bg-violet-600/30 transition-all">
                        <Download className="w-4 h-4" />Download JSON
                      </button>
                    )}
                  </div>
                  {previewOpen && currentBuild.output_html && (
                    <div className="rounded-xl overflow-hidden border border-slate-700">
                      <p className="text-xs text-slate-500 px-3 py-1.5 bg-slate-800 border-b border-slate-700">Sandboxed preview</p>
                      <iframe srcDoc={currentBuild.output_html} className="w-full h-96 bg-white" sandbox="allow-scripts" title="Generated site preview" />
                    </div>
                  )}
                  {currentBuild.output_json && !currentBuild.output_html && (
                    <pre className="bg-slate-800 rounded-xl p-4 text-xs text-slate-300 overflow-auto max-h-80 whitespace-pre-wrap">
                      {JSON.stringify(currentBuild.output_json, null, 2).slice(0, 3000)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Generate Brand Image</p>
          <p className="text-[11px] text-slate-500 mt-1">Real image generation via Gemini's native image model — describe a hero image, icon, or product shot.</p>
        </div>
        <div className="flex gap-2">
          <input value={imagePrompt} onChange={e => setImagePrompt(e.target.value)} placeholder="e.g. minimalist hero illustration of a modern chicken restaurant storefront, warm orange palette"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500" />
          <button onClick={generateBrandImage} disabled={!imagePrompt.trim() || generatingImage}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-all whitespace-nowrap">
            {generatingImage ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Generate'}
          </button>
        </div>
        {imageError && (
          <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
            <XCircle className="w-4 h-4 shrink-0" />{imageError}
          </div>
        )}
        {generatedImage && (
          <div className="space-y-2">
            <img src={`data:${generatedImage.mimeType};base64,${generatedImage.base64}`} alt="Generated brand image" className="max-w-md rounded-xl border border-slate-700" />
            <button onClick={downloadImage} className="flex items-center gap-2 px-3 py-1.5 bg-violet-600/20 border border-violet-500/30 text-violet-400 text-xs font-medium rounded-lg hover:bg-violet-600/30 transition-all w-fit">
              <Download className="w-3 h-3" />Download
            </button>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent builds</p>
          <div className="space-y-2">
            {history.map((b) => (
              <div key={b.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <div className="flex items-center gap-3">
                  {b.status === 'complete' ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" /> : b.status === 'failed' ? <XCircle className="w-4 h-4 text-rose-400 shrink-0" /> : <Clock className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />}
                  <div>
                    <p className="text-sm font-medium">{b.brand_name}</p>
                    <p className="text-xs text-slate-500 capitalize">{b.build_type} · {new Date(b.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {b.deployed_url && <a href={b.deployed_url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 flex items-center gap-1 hover:underline"><ExternalLink className="w-3 h-3" />Live</a>}
                  {b.status === 'complete' && <button onClick={async () => { const { data } = await supabase.functions.invoke('builder-engine', { body: { action: 'status', build_id: b.id } }); setCurrentBuild(data?.build ?? data ?? b); setPreviewOpen(true); }} className="text-xs text-violet-400 hover:text-violet-300">View</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
