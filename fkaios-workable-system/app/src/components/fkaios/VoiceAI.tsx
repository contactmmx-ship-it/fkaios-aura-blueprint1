'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Settings, Sparkles, MessageSquare, RotateCcw, Bot, User } from 'lucide-react';

type Tone = 'professional' | 'friendly' | 'persuasive';
type CallPhase = 'idle' | 'ringing' | 'introduction' | 'discovery' | 'presentation' | 'objection' | 'closing' | 'followup';

const BRAND_PROFILES = [
  { name: 'Franchisee Kart', investment: '10L - 50L', royalty: '5-8%', setup: '4-6 weeks', usp: 'Multi-brand franchise platform with AI-powered operations' },
  { name: 'QuickShelf', investment: '8L - 25L', royalty: '4-6%', setup: '2-3 weeks', usp: 'Q-Commerce retail with quick delivery infrastructure' },
  { name: 'BrandBooster', investment: '5L - 20L', royalty: '3-5%', setup: '1-2 weeks', usp: 'AI-driven marketing franchise for local businesses' },
];

const TONES: Record<Tone, { label: string; desc: string }> = {
  professional: { label: 'Professional', desc: 'Formal corporate tone' },
  friendly: { label: 'Friendly', desc: 'Warm conversational' },
  persuasive: { label: 'Persuasive', desc: 'Sales-driven assertive' },
};

const PHASE_LABELS: Record<CallPhase, string> = {
  idle: 'Ready', ringing: 'Ringing...', introduction: 'Introduction', discovery: 'Discovery',
  presentation: 'Presentation', objection: 'Objection Handling', closing: 'Closing', followup: 'Follow-up',
};

export default function VoiceAI() {
  const [tone, setTone] = useState<Tone>('professional');
  const [brand, setBrand] = useState(0);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [conversation, setConversation] = useState<{ role: 'user' | 'ai'; text: string; }[]>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [statusText, setStatusText] = useState('Ready to start a call');

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const conversationRef = useRef(conversation);
  const brandRef = useRef(brand);
  const toneRef = useRef(tone);

  // Keep refs in sync
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  useEffect(() => { brandRef.current = brand; }, [brand]);
  useEffect(() => { toneRef.current = tone; }, [tone]);
  useEffect(() => { synthRef.current = window.speechSynthesis; }, []);

  // Call timer
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'ringing') {
      timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setCallDuration(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  // AI response via Brain API
  const getAIResponse = useCallback(async (userText: string): Promise<string> => {
    const brandInfo = BRAND_PROFILES[brandRef.current];
    const systemContext = `You are ARIA, an AI franchise sales consultant for ${brandInfo.name}. 
Investment range: Rs.${brandInfo.investment}, Royalty: ${brandInfo.royalty}, Setup: ${brandInfo.setup}. 
USP: ${brandInfo.usp}. Current call phase: ${phase}. Tone: ${toneRef.current}.
Respond as a real sales consultant would in a voice call. Keep responses concise (2-4 sentences) since this is spoken.
${toneRef.current === 'friendly' ? 'Use warm, conversational language.' : ''}
${toneRef.current === 'persuasive' ? 'Be assertive and highlight value propositions.' : ''}
${toneRef.current === 'professional' ? 'Use formal, business-appropriate language.' : ''}`;

    try {
      const messages = [
        { role: 'assistant' as const, content: systemContext },
        ...conversationRef.current.map(m => ({ role: m.role as 'user' | 'assistant', content: m.text })),
        { role: 'user' as const, content: userText },
      ];
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      const data = await res.json();
      return data.response || `Thank you for your interest in ${brandInfo.name}. I'd love to share more details about our franchise opportunity. What specific aspect would you like to explore — investment details, territory availability, or support structure?`;
    } catch {
      return `I appreciate your question about ${brandInfo.name}. Let me highlight our key advantage — ${brandInfo.usp}. Would you like to know more about the investment structure?`;
    }
  }, [phase]);

  // Text-to-speech (real browser API)
  const speak = useCallback((text: string) => {
    if (muted || !synthRef.current) return;
    synthRef.current.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ''));
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    utterance.lang = 'en-IN';

    // Try to find a good voice
    const voices = synthRef.current.getVoices();
    const preferred = voices.find(v => v.name.includes('Google') && v.lang.startsWith('en'))
      || voices.find(v => v.lang.startsWith('en-IN'))
      || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    synthRef.current.speak(utterance);
  }, [muted]);

  // Detect call phase from conversation
  const detectPhase = useCallback((text: string): CallPhase => {
    const t = text.toLowerCase();
    if (t.includes('interested') || t.includes('tell me') || t.includes('how much') || t.includes('investment') || t.includes('cost')) return 'discovery';
    if (t.includes('compare') || t.includes('detail') || t.includes('explain') || t.includes('more about')) return 'presentation';
    if (t.includes('concern') || t.includes('risk') || t.includes('expensive') || t.includes('compete') || t.includes('worried')) return 'objection';
    if (t.includes('sign') || t.includes('agree') || t.includes('proceed') || t.includes('ready') || t.includes('when can')) return 'closing';
    if (t.includes('follow') || t.includes('later') || t.includes('think') || t.includes('discuss')) return 'followup';
    return phase;
  }, [phase]);

  // Start/stop call
  const toggleCall = useCallback(async () => {
    if (phase !== 'idle') {
      // End call
      if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
      synthRef.current?.cancel();
      setPhase('idle');
      setStatusText('Call ended');
      return;
    }

    // Start call
    setPhase('ringing');
    setStatusText('Connecting to AI sales agent...');
    setConversation([]);

    setTimeout(async () => {
      setPhase('introduction');
      const brandInfo = BRAND_PROFILES[brand];
      const greeting = tone === 'professional'
        ? `Good day! Thank you for your interest in ${brandInfo.name}. My name is ARIA, your AI franchise consultant. I'm here to help you explore our franchise opportunity. Could you start by telling me a bit about your background and what you're looking for?`
        : tone === 'friendly'
        ? `Hi there! Welcome to ${brandInfo.name}! I'm ARIA, and I'll be your franchise guide today. I'm excited to tell you about what makes us special. First off, what brings you to explore franchise opportunities with us?`
        : `Hello! Great to connect with you about ${brandInfo.name}. You're looking at one of the most exciting franchise opportunities in the market right now. Let me start by understanding — what's your investment range and which city are you looking at?`;
      setConversation([{ role: 'ai', text: greeting }]);
      speak(greeting);
      setStatusText('ARIA is speaking...');

      // Start speech recognition after greeting
      setTimeout(() => startListening(), 6000);
    }, 2000);
  }, [phase, brand, tone, speak]);

  // Speech recognition (real browser API)
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setStatusText('Speech recognition not supported in this browser. Please use Chrome.'); return; }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';

    recognition.onstart = () => { setIsListening(true); setStatusText('Listening...'); };
    recognition.onend = () => { setIsListening(false); };

    recognition.onresult = async (event: any) => {
      const text = event.results[0][0].transcript;
      const confidence = event.results[0][0].confidence;
      setConversation(prev => [...prev, { role: 'user', text }]);
      setStatusText('Processing...');

      // Detect phase shift
      const newPhase = detectPhase(text);
      setPhase(newPhase);

      // Get AI response
      const response = await getAIResponse(text);
      setConversation(prev => [...prev, { role: 'ai', text: response }]);
      speak(response);
      setStatusText('ARIA is responding...');

      // Listen again after response
      setTimeout(() => { if (phase !== 'idle') startListening(); }, 8000);
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      if (event.error !== 'aborted') {
        setStatusText(`Speech error: ${event.error}. Click mic to retry.`);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [phase, detectPhase, getAIResponse, speak]);

  // Manual mic toggle
  const toggleMic = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setStatusText('Microphone paused');
    } else if (phase !== 'idle' && phase !== 'ringing') {
      startListening();
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full max-h-[calc(100vh-10rem)]">
      {/* Left: Call Controls */}
      <div className="lg:w-80 shrink-0 space-y-4">
        {/* Settings */}
        {showSettings && (
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Settings className="w-4 h-4" /> Call Settings</h3>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Brand</label>
              <div className="space-y-1">
                {BRAND_PROFILES.map((b, i) => (
                  <button key={b.name} onClick={() => setBrand(i)} disabled={phase !== 'idle'}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all cursor-pointer ${brand === i ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'} ${phase !== 'idle' ? 'opacity-50' : ''}`}>
                    <span className="font-medium">{b.name}</span>
                    <span className="text-slate-500 ml-1">({b.investment})</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Tone</label>
              <div className="grid grid-cols-3 gap-1">
                {(Object.entries(TONES) as [Tone, { label: string; desc: string }][]).map(([key, val]) => (
                  <button key={key} onClick={() => setTone(key)} disabled={phase !== 'idle'}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all cursor-pointer ${tone === key ? 'bg-purple-600/20 text-purple-400 border border-purple-600/30' : 'bg-slate-800 text-slate-400 border border-slate-700'} ${phase !== 'idle' ? 'opacity-50' : ''}`}>
                    {val.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => setShowSettings(false)} className="w-full py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer">Close Settings</button>
          </div>
        )}

        {/* Call Status Card */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 flex flex-col items-center gap-4">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${phase === 'idle' ? 'bg-slate-800' : phase === 'ringing' ? 'bg-yellow-500/20 animate-pulse' : 'bg-emerald-500/20 animate-pulse'}`}>
            {phase === 'idle' ? <Phone className="w-8 h-8 text-slate-400" /> : <Bot className="w-8 h-8 text-emerald-400" />}
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">ARIA Voice AI</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{BRAND_PROFILES[brand].name} Franchise Consultant</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-mono font-bold text-white">{formatTime(callDuration)}</p>
            <p className="text-[10px] text-slate-400">{statusText}</p>
          </div>

          {/* Phase Indicator */}
          {phase !== 'idle' && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 border border-slate-700">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] text-blue-400 font-medium">{PHASE_LABELS[phase]}</span>
            </div>
          )}

          {/* Call Buttons */}
          <div className="flex items-center gap-3">
            <button onClick={toggleMic} disabled={phase === 'idle' || phase === 'ringing'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${isListening ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-400'} ${phase === 'idle' || phase === 'ringing' ? 'opacity-30 cursor-not-allowed' : 'hover:bg-blue-400'}`}>
              {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>
            <button onClick={toggleCall}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all cursor-pointer ${phase === 'idle' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}`}>
              {phase === 'idle' ? <Phone className="w-7 h-7" /> : <PhoneOff className="w-7 h-7" />}
            </button>
            <button onClick={() => setMuted(!muted)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${muted ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          </div>

          <button onClick={() => setShowSettings(!showSettings)} className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer flex items-center gap-1">
            <Settings className="w-3 h-3" /> {showSettings ? 'Hide' : 'Show'} Settings
          </button>
        </div>

        {/* Live Indicators */}
        <div className="grid grid-cols-2 gap-2">
          <div className={`rounded-lg p-3 text-center border transition-all ${isListening ? 'bg-blue-500/10 border-blue-500/30' : 'bg-slate-900 border-slate-800'}`}>
            <Mic className={`w-4 h-4 mx-auto mb-1 ${isListening ? 'text-blue-400' : 'text-slate-600'}`} />
            <p className="text-[10px] text-slate-400">{isListening ? 'Listening' : 'Mic Off'}</p>
          </div>
          <div className={`rounded-lg p-3 text-center border transition-all ${isSpeaking ? 'bg-purple-500/10 border-purple-500/30' : 'bg-slate-900 border-slate-800'}`}>
            <Volume2 className={`w-4 h-4 mx-auto mb-1 ${isSpeaking ? 'text-purple-400' : 'text-slate-600'}`} />
            <p className="text-[10px] text-slate-400">{isSpeaking ? 'Speaking' : 'Silent'}</p>
          </div>
        </div>
      </div>

      {/* Right: Conversation Log */}
      <div className="flex-1 bg-slate-900 rounded-xl border border-slate-800 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-slate-400" /> Conversation Log
          </h3>
          {conversation.length > 0 && (
            <button onClick={() => { setConversation([]); setPhase('idle'); }}
              className="text-slate-500 hover:text-slate-300 cursor-pointer flex items-center gap-1 text-xs">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {conversation.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <Sparkles className="w-10 h-10 text-slate-700" />
              <div>
                <p className="text-sm text-slate-400">No conversation yet</p>
                <p className="text-xs text-slate-600 mt-1">Start a call to begin speaking with ARIA</p>
              </div>
            </div>
          ) : (
            conversation.map((msg, i) => (
              <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'ai' && (
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className={`max-w-[75%] px-3.5 py-2.5 rounded-xl text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-600/20 text-blue-100 border border-blue-600/30 rounded-br-sm'
                    : 'bg-slate-800 text-slate-200 border border-slate-700/50 rounded-bl-sm'
                }`}>
                  {msg.text}
                </div>
                {msg.role === 'user' && (
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}