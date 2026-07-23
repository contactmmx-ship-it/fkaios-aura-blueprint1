'use client';

// IntelligenceOrb — reusable Jarvis-style glowing intelligence core for the
// FKAIOS cockpit UI. Idle-only in this phase: no voice input/output, no AI
// state, no data connection — purely a visual centerpiece. A later, separate
// phase will connect IDLE/THINKING/LEARNING/ALERT states; until that's
// approved this stays visual-only. Built entirely on the Phase 1 CSS tokens
// plus Tailwind's built-in animate-pulse/animate-spin (no new keyframes
// needed, no external animation library).
//
// Phase 4B: doubled the default scale and layered in a second ambient glow,
// a counter-rotating inner ring and a glossy core highlight so it reads as
// a "living" engine rather than a flat badge.

export interface IntelligenceOrbProps {
  /** Diameter in pixels at rest. Clamped to 90vw so it never overflows a narrow viewport. */
  size?: number;
  className?: string;
}

export default function IntelligenceOrb({ size = 360, className = '' }: IntelligenceOrbProps) {
  return (
    <div
      aria-hidden
      className={`relative flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, maxWidth: '90vw', maxHeight: '90vw' }}
    >
      {/* Deepest ambient glow — largest, slowest, most blurred layer for real depth */}
      <div
        className="absolute -inset-[15%] rounded-full blur-3xl animate-pulse"
        style={{
          background: 'radial-gradient(circle, var(--cockpit-glow-blue) 0%, transparent 65%)',
          animationDuration: 'calc(var(--cockpit-pulse-speed) * 1.6)',
        }}
      />

      {/* Outer breathing glow */}
      <div
        className="absolute inset-0 rounded-full blur-2xl animate-pulse"
        style={{
          background: 'radial-gradient(circle, var(--cockpit-glow-cyan) 0%, transparent 70%)',
          animationDuration: 'var(--cockpit-pulse-speed)',
          animationDelay: '0.3s',
        }}
      />

      {/* Faint static outer ring — the field boundary */}
      <div className="absolute inset-0 rounded-full" style={{ border: '1px solid var(--cockpit-glass-border)' }} />

      {/* Slow rotating ring, cyan accent — the "reactor" cue */}
      <div
        className="absolute inset-[8%] rounded-full animate-spin"
        style={{
          border: '1px solid var(--cockpit-glass-border)',
          borderTopColor: 'var(--cockpit-glow-cyan)',
          animationDuration: '9s',
        }}
      />

      {/* Counter-rotating inner ring, blue accent — gives the core mechanical depth */}
      <div
        className="absolute inset-[18%] rounded-full animate-spin [animation-direction:reverse]"
        style={{
          border: '1px solid var(--cockpit-glass-border)',
          borderBottomColor: 'var(--cockpit-glow-blue)',
          animationDuration: '14s',
        }}
      />

      {/* Faint static inner ring for layered depth */}
      <div className="absolute inset-[27%] rounded-full" style={{ border: '1px solid var(--cockpit-glass-border)' }} />

      {/* Core — the living center */}
      <div
        className="absolute inset-[32%] rounded-full animate-pulse"
        style={{
          background: 'radial-gradient(circle at 35% 30%, #d5f9ff 0%, var(--cockpit-glow-cyan) 45%, #0e7490 100%)',
          boxShadow: '0 0 60px var(--cockpit-glow-cyan)',
          animationDuration: 'var(--cockpit-pulse-speed)',
        }}
      />

      {/* Glossy highlight — small offset glare so the core doesn't read as flat */}
      <div
        className="absolute inset-[32%] rounded-full opacity-60"
        style={{ background: 'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.8) 0%, transparent 30%)' }}
      />
    </div>
  );
}
