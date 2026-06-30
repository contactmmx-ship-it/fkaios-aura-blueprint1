'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function KnowledgeVault() {
  const [brands, setBrands] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.from('brain_brands').select('*').order('name').then(({ data }) => {
      if (data && data.length > 0) { setBrands(data); setSelectedBrandId(data[0].id); }
    });
  }, []);

  useEffect(() => {
    if (!selectedBrandId) return;
    supabase.from('brain_knowledge_folders').select('*, _count:brain_knowledge_documents(count)').eq('brand_id', selectedBrandId).order('name').then(({ data }) => setFolders(data || []));
  }, [selectedBrandId]);

  useEffect(() => {
    if (!selectedBrandId) return;
    let q = supabase.from('brain_knowledge_documents').select('*, folder:brain_knowledge_folders(name), brand:brain_brands(name, color)').eq('brand_id', selectedBrandId).eq('status', 'active').order('updated_at', { ascending: false }).limit(100);
    if (selectedFolderId) q = q.eq('folder_id', selectedFolderId);
    if (search) q = q.ilike('title', `%${search}%`);
    q.then(({ data }) => setDocuments(data || []));
  }, [selectedBrandId, selectedFolderId, search]);

  const selectedBrand = brands.find((b: any) => b.id === selectedBrandId);
  const filteredDocs = selectedFolderId ? documents.filter((d: any) => d.folder_id === selectedFolderId) : documents;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-white">Knowledge Vault</h1>
          <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full">RAG + OCR + Embeddings</span>
        </div>
      </div>

      <div className="flex gap-3">
        <select value={selectedBrandId} onChange={e => { setSelectedBrandId(e.target.value); setSelectedFolderId(null); }}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
          {brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="flex-1 relative">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-52 shrink-0">
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Folders</h3>
          <button onClick={() => setSelectedFolderId(null)}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs mb-0.5 transition-colors cursor-pointer ${!selectedFolderId ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400 hover:bg-slate-800/50'}`}>
            All Documents
          </button>
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto space-y-0.5">
            {folders.map((f: any) => (
              <button key={f.id} onClick={() => setSelectedFolderId(f.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs flex justify-between transition-colors cursor-pointer ${f.id === selectedFolderId ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400 hover:bg-slate-800/50'}`}>
                <span className="truncate">{f.name}</span>
                <span className="text-[10px] opacity-60 ml-1">{f._count?.count || 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1">
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{filteredDocs.length} Documents</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredDocs.map((doc: any) => (
              <div key={doc.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 text-slate-500 text-xs font-bold">FILE</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">{doc.title}</p>
                    {doc.folder && <p className="text-[10px] text-slate-500">{doc.folder.name}</p>}
                    <div className="flex gap-1.5 mt-2">
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{(doc.file_type || 'txt').toUpperCase()}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">v{doc.version}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{doc.category}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {filteredDocs.length === 0 && <div className="col-span-2 text-center py-12 text-slate-500"><p className="text-sm">No documents found</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}