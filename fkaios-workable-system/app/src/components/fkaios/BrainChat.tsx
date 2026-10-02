'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Brain, Sparkles, Trash2, Loader2 } from 'lucide-react';

interface Message { role: 'user' | 'assistant'; content: string; }

const SUGGESTIONS = [
  'What is FKAIOS?',
  'Show my pipeline status',
  'How does lead scoring work?',
  'Tell me about the 25 AI agents',
  'Compare franchise brands',
  'How to use the Decision Engine?',
];

export default function BrainChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [brainStatus, setBrainStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check brain status
  useEffect(() => {
    fetch('/api/brain').then(r => r.json()).then(data => {
      setBrainStatus(data.status === 'online' ? 'online' : 'offline');
    }).catch(() => setBrainStatus('offline'));
  }, []);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated }),
      });
      const data = await res.json();

      if (data.response) {
        setMessages([...updated, { role: 'assistant', content: data.response }]);
      } else {
        setMessages([...updated, { role: 'assistant', content: 'I encountered an error processing your request. Please try again.' }]);
      }
    } catch {
      setMessages([...updated, { role: 'assistant', content: 'Connection to the Brain Engine failed. Please check your network and try again.' }]);
    }
    setLoading(false);
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const clearChat = () => setMessages([]);

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-10rem)]">
      {/* Brain Status Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${brainStatus === 'online' ? 'bg-emerald-400 animate-pulse' : brainStatus === 'checking' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-xs text-slate-400">
            {brainStatus === 'online' ? 'Brain Engine Online' : brainStatus === 'checking' ? 'Connecting...' : 'Brain Engine Offline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-600 px-2 py-0.5 rounded bg-slate-800/50">
            {brainStatus === 'online' ? 'AI-Powered' : 'Local Fallback'}
          </span>
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer" title="Clear chat">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center">
              <Brain className="w-8 h-8 text-purple-400" />
            </div>
            <div className="text-center max-w-md">
              <h3 className="text-lg font-semibold text-white mb-2">FKAIOS Brain</h3>
              <p className="text-sm text-slate-400">Ask me anything about your franchise operations, AI agents, pipeline data, or business strategy.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => sendMessage(s)}
                  className="text-left px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs text-slate-300 hover:text-white hover:bg-slate-700/50 hover:border-slate-600/50 transition-all cursor-pointer">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                <Brain className="w-4 h-4 text-white" />
              </div>
            )}
            <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-slate-800 text-slate-200 border border-slate-700/50 rounded-bl-md'
            }`}>
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-emerald-400" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-slate-800 border border-slate-700/50">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                <span className="text-sm text-slate-400">Brain is thinking...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the FKAIOS Brain anything..."
          rows={1}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 resize-none max-h-32"
          style={{ minHeight: '44px' }}
        />
        <button type="submit" disabled={loading || !input.trim()}
          className="w-11 h-11 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}