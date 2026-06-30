'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Mic, MicOff, Phone, PhoneOff, Send, Bot, User, Volume2, VolumeX, Settings, Sparkles, MessageSquare, RotateCcw } from 'lucide-react';

type Tone = 'professional' | 'friendly' | 'persuasive';
type CallPhase = 'idle' | 'ringing' | 'introduction' | 'discovery' | 'presentation' | 'objection' | 'closing' | 'followup';

const BRAND_PROFILES: Record<string, { investment: string; royalty: string; setup: string; usp: string }> = {
  'Franchisee Kart': { investment: '₹10L – ₹50L', royalty: '5-8% of revenue', setup: '4-6 weeks', usp: 'Multi-brand franchise platform with AI-powered operations' },
  'QuickShelf': { investment: '₹8L – ₹25L', royalty: '4-6% of revenue', setup: '2-3 weeks', usp: 'Q-Commerce retail with quick delivery infrastructure' },
  'BrandBooster': { investment: '₹5L – ₹20L', royalty: '3-5% of revenue', setup: '1-2 weeks', usp: 'AI-driven marketing franchise for local businesses' },
};

const TONE_CONFIG: Record<Tone, { label: string; desc: string; greeting: string; closer: string }> = {
  professional: {
    label: 'Professional', desc: 'Formal corporate tone',
    greeting: 'Good day, thank you for your interest in Franchisee Kart. My name is ARIA, your AI franchise consultant. I\'m here to provide you with detailed information about our franchise opportunities and help you find the perfect fit for your investment goals. How may I assist you today?',
    closer: 'Thank you for your time today. I\'ll prepare a detailed franchise proposal based on our discussion and have our team reach out within 24 hours. Is there anything else I can help you with?'
  },
  friendly: {
    label: 'Friendly', desc: 'Warm conversational tone',
    greeting: 'Hey there! Welcome to Franchisee Kart! I\'m ARIA, your personal franchise guide. I\'m super excited to help you explore our amazing franchise opportunities. Think of me as your franchise buddy who knows everything about our brands. What brings you here today?',
    closer: 'It\'s been great chatting with you! I\'ll put together a personalized franchise recommendation just for you. Our team will get in touch tomorrow to take things forward. Anything else you\'d like to know?'
  },
  persuasive: {
    label: 'Persuasive', desc: 'Results-driven sales tone',
    greeting: 'Welcome! You\'ve made a smart decision exploring Franchisee Kart today. I\'m ARIA, and I\'m here to show you why our franchise platform is built for entrepreneurs who want to run their own business. Ready to hear more?',
    closer: 'Based on our conversation, I\'m confident we have the perfect franchise match for you. Our top-performing franchisees started exactly where you are today. Shall I connect you with our franchise success team right now to get you started?'
  },
};


function detectIntent(msg: string): string {
  const m = msg.toLowerCase();
  if (m.match(/price|cost|invest|how much|fee|expensive|cheap|budget|afford|payment|emi|financ/)) return 'pricing';
  if (m.match(/support|help|train|guidance|assist|manager|mentor|team behind/)) return 'support';
  if (m.match(/time|how long|when|start|launch|duration|week|month|quick|fast/)) return 'timeline';
  if (m.match(/compet|other|compare|better|why you|vs|versus|different|unique|special/)) return 'competition';
  if (m.match(/roi|return|profit|revenue|earn|money back|income|salary|financial result/)) return 'roi';
  return 'general';
}


export default function VoiceAI() {
  const [isListening, setIsListening] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tone, setTone] = useState<Tone>('professional');
  const [brand, setBrand] = useState('Franchisee Kart');
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; time: string }[]>([]);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCallActive) interval = setInterval(() => setCallDuration(p => p + 1), 1000);
    return () => clearInterval(interval);
  }, [isCallActive]);

  const speak = useCallback((text: string) => {
    if (muted) return;
    const clean = text.replace(/\*\*/g, '').replace(/[•|]/g, '');
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.0;
    utterance.pitch = tone === 'friendly' ? 1.2 : tone === 'persuasive' ? 0.9 : 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;
    setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    synthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [tone, muted]);

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const addMessage = (role: 'user' | 'assistant', content: string) => {
    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    setMessages(prev => [...prev, { role, content, time }]);
  };

  const startCall = () => {
    setIsCallActive(true);
    setPhase('introduction');
    setCallDuration(0);
    setMessages([]);
    const greeting = TONE_CONFIG[tone].greeting;
    addMessage('assistant', greeting);
    setTimeout(() => speak(greeting), 500);
  };

  const endCall = () => {
    stopSpeaking();
    if (isListening && recognitionRef.current) recognitionRef.current.stop();
    const closer = TONE_CONFIG[tone].closer;
    addMessage('assistant', closer);
    setIsCallActive(false);
    setIsListening(false);
    setPhase('idle');
    setCallDuration(0);
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addMessage('assistant', 'Speech recognition is not supported in this browser. Please use Chrome or Edge, or type your message below.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onresult = (event: any) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      if (final) {
        setTranscript('');
        handleUserMessage(final);
      } else {
        setTranscript(interim);
      }
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleUserMessage = async (text: string) => {
    if (!isCallActive) return;
    stopSpeaking();
    addMessage('user', text);
    const intent = detectIntent(text);
    if (intent === 'pricing' || intent === 'roi') setPhase('presentation');
    else if (intent === 'competition' || intent === 'support') setPhase('objection');

    let response = '';
    try {
      const { data, error } = await supabase.functions.invoke('sales-engine', {
        body: {
          action: 'reply',
          tone: tone === 'persuasive' ? 'aggressive' : tone,
          message: text,
          history: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'sales-engine failed');
      response = data.reply;
    } catch (e: any) {
      response = `I'm having trouble reaching the AI brain right now (${e?.message || 'unknown error'}). One moment.`;
    }
    addMessage('assistant', response);
    speak(response);
  };

  const sendTextMessage = () => {
    if (!input.trim() || !isCallActive) return;
    handleUserMessage(input.trim());
    setInput('');
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const PHASE_STEPS: { id: CallPhase; label: string }[] = [
    { id: 'ringing', label: 'Ring' },
    { id: 'introduction', label: 'Intro' },
    { id: 'discovery', label: 'Discover' },
    { id: 'presentation', label: 'Present' },
    { id: 'objection', label: 'Handle' },
    { id: 'closing', label: 'Close' },
    { id: 'followup', label: 'Follow-up' },
  ];
  const phaseIdx = PHASE_STEPS.findIndex(p => p.id === phase);

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Main call area */}
      <div className="flex-1 flex flex-col bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">ARIA Voice AI — Sales Representative</h2>
              <p className="text-[10px] text-slate-500">AI-Powered Voice Sales Agent &middot; {isCallActive ? `Duration: ${formatDuration(callDuration)}` : 'Ready to call'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isCallActive && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-emerald-400 font-medium">On Call</span>
              </div>
            )}
            <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Phase tracker */}
        {isCallActive && (
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-1">
              {PHASE_STEPS.map((p, i) => (
                <div key={p.id} className="flex items-center gap-1 flex-1">
                  <div className={`h-1.5 flex-1 rounded-full transition-colors ${i <= phaseIdx ? 'bg-emerald-500' : 'bg-slate-800'}`} title={p.label} />
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-1.5">
              {PHASE_STEPS.map((p) => (
                <span key={p.id} className={`text-[8px] ${p.id === phase ? 'text-emerald-400 font-semibold' : 'text-slate-600'}`}>{p.label}</span>
              ))}
            </div>
          </div>
        )}

        {/* Settings panel */}
        {showSettings && (
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-800/30 space-y-4">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2 block">Brand</label>
              <div className="flex gap-2">
                {Object.keys(BRAND_PROFILES).map(b => (
                  <button key={b} onClick={() => setBrand(b)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${brand === b ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}>
                    {b.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2 block">Voice Tone</label>
              <div className="flex gap-2">
                {(Object.keys(TONE_CONFIG) as Tone[]).map(t => (
                  <button key={t} onClick={() => setTone(t)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${tone === t ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}>
                    {TONE_CONFIG[t].label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">{TONE_CONFIG[tone].desc}</p>
            </div>
          </div>
        )}

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!isCallActive && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-5">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-emerald-400" />
              </div>
              <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold text-white">ARIA Voice AI</h3>
                <p className="text-sm text-slate-400 mt-2">AI-powered voice sales representative that calls leads, handles objections, and closes franchise deals using natural voice conversation.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                {['Tell me about pricing', 'What support do you provide?', 'How does it compare to competitors?', 'What ROI can I expect?'].map(q => (
                  <button key={q} onClick={() => { setInput(q); }}
                    className="text-left px-3 py-2.5 rounded-lg border border-slate-700 hover:border-emerald-500/30 hover:bg-slate-800/50 transition-all text-xs text-slate-300 cursor-pointer">{q}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700">
                <Phone className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-slate-400">Press the call button to start a voice conversation</span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200 border border-slate-700'}`}>
                    <p className="text-[10px] text-slate-500 mb-1">{msg.role === 'assistant' ? 'ARIA' : 'You'} &middot; {msg.time}</p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 mt-1">
                      <User className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                </div>
              ))}
              {/* Listening indicator */}
              {isListening && (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center animate-pulse">
                    <Mic className="w-3.5 h-3.5 text-red-400" />
                  </div>
                  <div className="bg-slate-800 rounded-xl px-4 py-3 border border-red-500/20">
                    <p className="text-xs text-red-400 font-medium mb-1">Listening...</p>
                    <p className="text-sm text-slate-300">{transcript || 'Speak now...'}</p>
                  </div>
                </div>
              )}
              {/* Speaking indicator */}
              {isSpeaking && !isListening && (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  </div>
                  <span className="text-xs text-emerald-400">ARIA is speaking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="p-4 border-t border-slate-800">
          {!isCallActive ? (
            <div className="flex items-center justify-center gap-3">
              <button onClick={startCall} className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors cursor-pointer">
                <Phone className="w-4 h-4" />
                Start Voice Call
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={toggleListening}
                className={`p-3 rounded-xl transition-all cursor-pointer ${isListening ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700'}`}>
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <form onSubmit={e => { e.preventDefault(); sendTextMessage(); }} className="flex-1 flex gap-2">
                <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..."
                  disabled={isSpeaking} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
                <button type="submit" disabled={!input.trim() || isSpeaking} className="p-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl transition-colors cursor-pointer">
                  <Send className="w-5 h-5" />
                </button>
              </form>
              <button onClick={() => setMuted(!muted)} className={`p-3 rounded-xl transition-all cursor-pointer ${muted ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700'}`}>
                {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <button onClick={endCall} className="p-3 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors cursor-pointer">
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar info */}
      <div className="w-64 shrink-0 flex flex-col gap-4">
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-white mb-3 flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-emerald-400" /> Call Context
          </h3>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between"><span className="text-slate-500">Brand</span><span className="text-white font-medium">{brand}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Tone</span><span className="text-purple-400 font-medium">{TONE_CONFIG[tone].label}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Phase</span><span className="text-emerald-400 font-medium capitalize">{phase}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Messages</span><span className="text-white">{messages.length}</span></div>
            {isCallActive && <div className="flex justify-between"><span className="text-slate-500">Duration</span><span className="text-white">{formatDuration(callDuration)}</span></div>}
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-white mb-3">Brand Info</h3>
          <div className="space-y-2 text-[11px]">
            <div><span className="text-slate-500">Investment:</span><p className="text-white font-medium">{BRAND_PROFILES[brand].investment}</p></div>
            <div><span className="text-slate-500">Royalty:</span><p className="text-white font-medium">{BRAND_PROFILES[brand].royalty}</p></div>
            <div><span className="text-slate-500">Setup:</span><p className="text-white font-medium">{BRAND_PROFILES[brand].setup}</p></div>
            <div><span className="text-slate-500">USP:</span><p className="text-slate-300">{BRAND_PROFILES[brand].usp}</p></div>
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-white mb-3">How It Works</h3>
          <ol className="space-y-1.5 text-[10px] text-slate-400 list-decimal list-inside">
            <li>Click <span className="text-emerald-400">Start Call</span> to begin</li>
            <li>Speak or type to converse</li>
            <li>ARIA detects intent and responds</li>
            <li>Call progresses through phases</li>
            <li>End call for follow-up summary</li>
          </ol>
        </div>
      </div>
    </div>
  );
}