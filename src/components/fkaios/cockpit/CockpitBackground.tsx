'use client';

// CockpitBackground — ambient control-room backdrop for the FKAIOS Phase 5
// cockpit UI (Jarvis-style CEO command center). Pure presentation: no props,
// no data, no external dependencies — built entirely from the Phase 1 CSS
// tokens (globals.css) plus Tailwind's built-in animate-pulse. Not mounted
// anywhere yet; a later phase wires it behind the cockpit layout.
export default function CockpitBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ background: 'var(--cockpit-bg-deep)' }}
    >
      {/* Ambient glow blobs — slow, subtle, never distracting */}
      <div
        className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full blur-3xl opacity-30 animate-pulse"
        style={{
          background: 'radial-gradient(circle, var(--cockpit-glow-cyan) 0%, transparent 70%)',
          animationDuration: 'var(--cockpit-pulse-speed)',
        }}
      />
      <div
        className="absolute top-1/3 -right-32 w-[30rem] h-[30rem] rounded-full blur-3xl opacity-20 animate-pulse"
        style={{
          background: 'radial-gradient(circle, var(--cockpit-glow-blue) 0%, transparent 70%)',
          animationDuration: 'var(--cockpit-pulse-speed)',
          animationDelay: '1.2s',
        }}
      />
      <div
        className="absolute -bottom-40 left-1/4 w-[26rem] h-[26rem] rounded-full blur-3xl opacity-20"
        style={{ background: 'radial-gradient(circle, var(--cockpit-glow-blue) 0%, transparent 70%)' }}
      />

      {/* Faint structural grid — the "control room floor" cue */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.5) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      {/* Vignette so panel edges recede into the background */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.55) 100%)' }}
      />
    </div>
  );
}
