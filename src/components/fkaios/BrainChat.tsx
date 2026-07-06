'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';


export default function BrainChat() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refreshConvList = () => {
    supabase.functions.invoke('brain-engine', { body: { action: 'list' } }).then(({ data }) => {
      if (data) setConversations(Array.isArray(data) ? data : []);
    }).catch(() => {});
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    const ac = new AbortController();
    const fetch = async () => {
      try {
        const { data } = await supabase.functions.invoke('brain-engine', { body: { action: 'list' } }, { signal: ac.signal as any });
        if (data && !ac.signal.aborted) setConversations(Array.isArray(data) ? data : []);
      } catch { /* ignore */ }
    };
    fetch();
    return () => ac.abort();
  }, []);

  const createChat = async () => {
    try {
      const { data } = await supabase.functions.invoke('brain-engine', { body: { action: 'create' } });
      if (data) { setActiveConvId(data.id); setMessages([]); refreshConvList(); }
    } catch (e) {
      // Fallback: create local conversation
      const fakeId = 'local-' + Date.now();
      setActiveConvId(fakeId);
      setMessages([]);
      setConversations(prev => [{ id: fakeId, title: 'New Conversation' }, ...prev]);
    }
  };

  const selectConv = async (id: string) => {
    setActiveConvId(id);
    try {
      const { data } = await supabase.functions.invoke('brain-engine', { body: { action: 'list' } });
      const conv = (data || []).find((c: any) => c.id === id);
      setMessages(conv?.messages || []);
    } catch { setMessages([]); }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    let convId = activeConvId;
    if (!convId) {
      const fakeId = 'local-' + Date.now();
      convId = fakeId;
      setActiveConvId(convId);
      setConversations(prev => [{ id: fakeId, title: input.trim().substring(0, 40) }, ...prev]);
    }
    const userMsg = input.trim();
    setInput('');
    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: userMsg, created_at: new Date().toISOString() }]);

    // Real brain-engine call only — no scripted fallback.
    // HONESTY FIX (2026-07-05): previously, any failure here fell through to
    // getSmartResponse(), a ~200-line bank of scripted answers with fabricated
    // stats (e.g. invented ROI figures and non-existent brands). Because
    // brain-engine had an RLS bug until 2026-07-05, that fallback was firing on
    // EVERY message — the AI Brain tab was serving 100% scripted responses
    // while appearing to work. Failures now say so plainly instead.
    let reply = null;
    let failureDetail = '';
    try {
      const { data, error } = await supabase.functions.invoke('brain-engine', { body: { action: 'message', conversationId: convId, message: userMsg } });
      if (error) failureDetail = error.message || 'edge function returned an error';
      if (data?.message) reply = data.message;
      else if (data?.content) reply = { role: 'assistant', content: data.content, created_at: new Date().toISOString() };
      else if (data?.error) failureDetail = data.error;
      refreshConvList();
    } catch (e) { failureDetail = e instanceof Error ? e.message : 'edge function unavailable'; }

    if (!reply) {
      reply = { role: 'assistant', content: `⚠ Brain engine call failed${failureDetail ? `: ${failureDetail}` : ''}. No answer was generated — this is a real error, not a canned response. Please retry; if it persists, check brain-engine logs in Supabase.`, created_at: new Date().toISOString() };
    }

    setMessages(prev => [...prev, reply]);
    setLoading(false);
  };

  const quickActions = ['Analyze my leads pipeline', 'Revenue report across brands', 'What agents are available?', 'Franchise expansion strategy', 'What is AURA Blueprint?', 'What can you do?'];

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <div className="w-56 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-white">Conversations</h2>
        </div>
        <button onClick={createChat} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors cursor-pointer">+ New Chat</button>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {conversations.map((c: any) => (
            <button key={c.id} onClick={() => selectConv(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${c.id === activeConvId ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}>
              <span className="truncate block">{c.title || 'New Conversation'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">B</span>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">FKAIOS Brain</h2>
            <p className="text-[10px] text-slate-500">Central AI Intelligence</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center"><span className="text-2xl text-purple-400 font-bold">AI</span></div>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-white">FKAIOS Brain</h3>
                <p className="text-sm text-slate-400 mt-1">Your central AI intelligence with access to CRM, Knowledge Vault, and 25+ agents.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-md mt-2">
                {quickActions.map(qa => (
                  <button key={qa} onClick={() => { setInput(qa); }}
                    className="text-left px-3 py-2.5 rounded-lg border border-slate-700 hover:border-blue-500/30 hover:bg-slate-800/50 transition-all text-xs text-slate-300 cursor-pointer">{qa}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
                    {m.role === 'assistant' && <p className="text-[10px] text-purple-400 mb-1">FKAIOS Brain</p>}
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
              {loading && <div className="flex items-center gap-2 text-slate-400 text-xs"><span className="animate-spin">...</span> Thinking...</div>}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-800">
          <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask FKAIOS Brain anything..."
              disabled={loading} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
            <button type="submit" disabled={loading || !input.trim()} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}