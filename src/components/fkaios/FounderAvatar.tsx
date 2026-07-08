'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const AVATAR_ORCHESTRATOR_URL = 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/avatar-orchestrator';

type TurnState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
type ConversationTurn = { role: 'founder' | 'avatar'; text: string; intent?: string; routedTo?: string };

/**
 * FounderAvatar — the voice front page of FK AIOS.
 *
 * Honest scope of this first version:
 * - Real STT via the browser's SpeechRecognition API (Chrome/Edge only —
 *   Safari/Firefox support is inconsistent; falls back to the text box).
 * - Real call to avatar-orchestrator, which classifies intent, answers
 *   general questions, runs a small set of wired read-only app actions, and
 *   is honest ("not wired yet") about anything else instead of faking it.
 * - Real TTS playback via ElevenLabs, once AVATAR_VOICE_ID is set as a
 *   Supabase secret to an actual Hindi/Indian-accented voice.
 * - Mic access requires one browser permission prompt per session — a
 *   browser security boundary, not something any app can remove.
 */
export default function FounderAvatar() {
  const [state, setState] = useState<TurnState>('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [textFallback, setTextFallback] = useState('');
  const [amplitude, setAmplitude] = useState(0);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const sessionId = useRef(crypto.randomUUID());
  const turnNumber = useRef(0);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const greetedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAccessToken(data.session?.access_token ?? null);
    });
  }, []);

  const playAudio = useCallback((base64: string) => {
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    audioRef.current = audio;
    setState('speaking');
    audio.onended = () => setState('idle');
    audio.onerror = () => setState('idle');
    void audio.play();
  }, []);

  const sendTurn = useCallback(
    async (transcript: string, inputMode: 'voice' | 'text', isGreeting = false) => {
      if (!transcript.trim() || !accessToken) return;
      turnNumber.current += 1;
      if (!isGreeting) setConversation((c) => [...c, { role: 'founder', text: transcript }]);
      setState('thinking');
      try {
        const res = await fetch(AVATAR_ORCHESTRATOR_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            transcript,
            session_id: sessionId.current,
            turn_number: turnNumber.current,
            input_mode: inputMode,
            wants_audio: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'avatar-orchestrator error');
        setConversation((c) => [...c, { role: 'avatar', text: data.response_text, intent: data.intent, routedTo: data.routed_to }]);
        if (data.audio_base64) playAudio(data.audio_base64);
        else setState('idle');
      } catch (err) {
        setConversation((c) => [...c, { role: 'avatar', text: `Something broke on my side: ${(err as Error).message}` }]);
        setState('error');
      }
    },
    [accessToken, playAudio]
  );

  // greet once the session token is actually available — not before,
  // and not with a hardcoded line (the greeting is a real LLM turn)
  useEffect(() => {
    if (accessToken && !greetedRef.current) {
      greetedRef.current = true;
      void sendTurn('Greet me for the day, briefly, the way you normally would.', 'text', true);
    }
  }, [accessToken, sendTurn]);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice input needs Chrome or Edge. Use the text box below for now.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN'; // best current browser match for code-switched Hinglish speech
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      setLiveTranscript(interim || final);
      if (final) {
        setLiveTranscript('');
        void sendTurn(final, 'voice');
      }
    };
    recognition.onerror = () => setState('idle');
    recognition.onend = () => setState((s) => (s === 'listening' ? 'idle' : s));

    recognitionRef.current = recognition;
    recognition.start();
    setState('listening');
  }, [sendTurn]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setState('idle');
  }, []);

  useEffect(() => {
    if (state !== 'speaking' || !audioRef.current) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = ctx.createMediaElementSource(audioRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setAmplitude(avg / 255);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(rafRef.current);
      ctx.close();
    };
  }, [state]);

  const orbScale = state === 'speaking' ? 1 + amplitude * 0.35 : state === 'listening' ? 1.08 : 1;

  if (!accessToken) {
    return (
      <div className="flex items-center justify-center h-96">
        <span className="text-slate-500 text-sm">Connecting to your session…</span>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] w-full flex flex-col items-center justify-center relative rounded-2xl bg-[#0B0B12] overflow-hidden -m-6 p-6">
      <div className="relative flex flex-col items-center gap-8">
        <button
          onClick={state === 'listening' ? stopListening : startListening}
          aria-label={state === 'listening' ? 'Stop listening' : 'Start talking'}
          className="relative w-48 h-48 rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-[#E8A33D]/60 cursor-pointer"
          style={{ transform: `scale(${orbScale})`, transition: 'transform 120ms ease-out' }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle at 35% 30%, #6C63FF 0%, #3A2E8C 55%, #17123B 100%)',
              boxShadow:
                state === 'listening'
                  ? '0 0 60px 12px rgba(232,163,61,0.45)'
                  : state === 'speaking'
                  ? `0 0 ${40 + amplitude * 60}px ${8 + amplitude * 20}px rgba(108,99,255,0.55)`
                  : '0 0 30px 6px rgba(108,99,255,0.25)',
              transition: 'box-shadow 120ms ease-out',
            }}
          />
          <div className="absolute inset-3 rounded-full border border-[#E8A33D]/30" />
        </button>

        <div className="text-center min-h-[3rem]">
          <p className="text-sm tracking-[0.2em] uppercase text-[#E8A33D]/80">
            {state === 'listening' ? 'Sun raha hoon, boss' : state === 'thinking' ? 'Soch raha hoon…' : state === 'speaking' ? 'Bol raha hoon' : 'Tap the orb, or type below'}
          </p>
          {liveTranscript && <p className="text-lg mt-2 text-[#F2EFE9]/80 italic">&ldquo;{liveTranscript}&rdquo;</p>}
        </div>
      </div>

      <div className="w-full max-w-xl mt-10 max-h-64 overflow-y-auto px-4 space-y-3 font-mono text-sm">
        {conversation.slice(-6).map((turn, i) => (
          <div key={i} className={turn.role === 'founder' ? 'text-[#F2EFE9]/60' : 'text-[#E8A33D]'}>
            <span className="opacity-50">{turn.role === 'founder' ? 'you  ' : 'avatar'} → </span>
            {turn.text}
          </div>
        ))}
      </div>

      <form
        className="w-full max-w-xl mt-6 px-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void sendTurn(textFallback, 'text');
          setTextFallback('');
        }}
      >
        <input
          value={textFallback}
          onChange={(e) => setTextFallback(e.target.value)}
          placeholder="Or type here if you'd rather not talk right now"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-[#F2EFE9] placeholder:text-white/30 focus:outline-none focus:border-[#E8A33D]/50"
        />
        <button type="submit" className="px-4 py-2 rounded-lg bg-[#E8A33D] text-[#17123B] text-sm font-medium cursor-pointer">
          Send
        </button>
      </form>
    </div>
  );
}
