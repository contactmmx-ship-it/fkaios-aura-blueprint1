'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const categoryColors: Record<string, string> = {
  sales: 'text-red-400', operations: 'text-blue-400', productivity: 'text-violet-400',
  knowledge: 'text-emerald-400', finance: 'text-amber-400', risk: 'text-orange-400',
  marketing: 'text-pink-400', franchise: 'text-teal-400', 'customer-success': 'text-rose-400',
  documents: 'text-cyan-400', intelligence: 'text-lime-400', general: 'text-slate-400',
};

export default function AgentFactory() {
  const [agents, setAgents] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [execOpen, setExecOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [execInput, setExecInput] = useState('');
  const [execOutput, setExecOutput] = useState('');
  const [executing, setExecuting] = useState(false);

  // Your real, live agents — 41 agents with actual job descriptions (charters),
  // each tied to a company and department. These are what actually run your
  // business. The 6 items below under "Agent Templates" are a separate,
  // generic sandbox for one-off ad-hoc runs — not connected to any company.
  const [companyAgents, setCompanyAgents] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('brain_agents').select('*').eq('status', 'active').order('is_prebuilt', { ascending: false }).order('name').then(({ data }) => setAgents(data || []));
    Promise.all([
      supabase.from('ai_agents').select('id, name, department, task, status, company_id, total_tasks_completed, success_rate, autonomy_level').eq('is_active', true).order('company_id').order('department'),
      supabase.from('companies').select('id, name'),
    ]).then(([a, c]) => {
      setCompanyAgents(a.data || []);
      setCompanies(c.data || []);
    });
  }, []);

  const filtered = filter === 'all' ? agents : agents.filter((a: any) => a.category === filter);
  const categories = ['all', ...new Set(agents.map((a: any) => a.category))];

  const executeAgent = async (agent: any) => {
    setSelectedAgent(agent); setExecInput(''); setExecOutput(''); setExecOpen(true);
  };

  const runExecution = async () => {
    if (!selectedAgent || !execInput.trim()) return;
    setExecuting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('agent-engine', { body: { action: 'execute', agentId: selectedAgent.id, input: execInput } });
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || 'Execution failed');
      setExecOutput(data?.execution?.output || data?.output || 'No output returned.');
    } catch (e) { setExecOutput(`ERROR: ${e instanceof Error ? e.message : 'Execution failed.'}`); }
    setExecuting(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-lg font-bold text-white">Your Company Agents</h1>
          <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full">{companyAgents.length} active, real</span>
        </div>
        {companies.map(co => {
          const list = companyAgents.filter(a => a.company_id === co.id);
          if (list.length === 0) return null;
          return (
            <div key={co.id} className="mb-4">
              <h2 className="text-xs font-semibold text-slate-400 mb-2">{co.name} <span className="text-slate-600">({list.length} agents)</span></h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {list.map(a => (
                  <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white truncate">{a.name}</p>
                      <span className="text-[9px] text-slate-500">L{a.autonomy_level ?? 0}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">{a.department}</p>
                    <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">{a.task}</p>
                    <div className="flex justify-between mt-1.5 text-[9px] text-slate-500">
                      <span>{a.total_tasks_completed ?? 0} tasks</span>
                      <span>{a.success_rate != null ? `${a.success_rate}% success` : 'no data yet'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {companyAgents.length === 0 && <p className="text-xs text-slate-500">No live company agents found.</p>}
      </div>

      <div className="border-t border-slate-800 pt-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-white">Agent Templates</h1>
          <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full">{agents.length} available — sandbox, not tied to a company</span>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {categories.map(c => (
          <button key={c} onClick={() => setFilter(c)}
            className={`px-3 py-1 rounded-full text-[11px] transition-colors cursor-pointer ${filter === c ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            {c === 'all' ? 'All' : c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((agent: any) => {
          const caps: string[] = agent.capabilities || [];
          return (
            <div key={agent.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-all">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: (agent.color || '#8b5cf6') + '30', color: agent.color }}>
                  {agent.name.charAt(0)}
                </div>
                <div className="flex items-center gap-1.5">
                  {agent.is_prebuilt && <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">Prebuilt</span>}
                  <span className={`text-[9px] ${categoryColors[agent.category] || 'text-slate-400'}`}>{agent.category}</span>
                </div>
              </div>
              <h3 className="text-sm font-semibold text-white mt-3">{agent.name}</h3>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">{agent.description}</p>
              {caps.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {caps.slice(0, 3).map((cap: string) => <span key={cap} className="text-[8px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded">{cap}</span>)}
                  {caps.length > 3 && <span className="text-[9px] text-slate-500">+{caps.length - 3}</span>}
                </div>
              )}
              <button onClick={() => executeAgent(agent)} className="w-full mt-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer">Execute Agent</button>
            </div>
          );
        })}
      </div>
      </div>

      {execOpen && selectedAgent && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setExecOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl h-[88vh] flex flex-col p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div>
                <h2 className="text-base font-bold text-white">{selectedAgent.name}</h2>
                <p className="text-xs text-slate-500">{selectedAgent.description}</p>
              </div>
              <button onClick={() => setExecOpen(false)} className="text-slate-400 hover:text-white text-lg cursor-pointer px-2">✕</button>
            </div>
            {/* Output takes ALL remaining height — was max-h-96 and unreadable on mobile */}
            <div className="flex-1 min-h-0 bg-slate-800 rounded-lg p-4 text-sm text-slate-200 whitespace-pre-wrap overflow-y-auto leading-relaxed">
              {executing ? 'Agent is working — real AI call in progress…' : (execOutput || 'Give the agent an instruction below, e.g. "Draft a follow-up for a cold Mr. Chick\'n lead in Ludhiana".')}
            </div>
            <div className="flex gap-2 mt-3 shrink-0">
              <textarea rows={2} value={execInput} onChange={e => setExecInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runExecution(); } }}
                placeholder="Enter input for the agent… (Enter to run, Shift+Enter for newline)"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none" />
              <button onClick={runExecution} disabled={executing || !execInput.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium cursor-pointer self-end">
                {executing ? 'Running…' : 'Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}