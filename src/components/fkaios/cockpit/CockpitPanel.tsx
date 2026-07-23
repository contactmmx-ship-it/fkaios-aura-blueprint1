'use client';
import { ReactNode, useState } from 'react';

// CockpitPanel — reusable glassmorphism card container for the FKAIOS
// cockpit UI. Pure presentation: takes props and renders children, no data
// fetching or business logic of its own. Built entirely on the Phase 1 CSS
// tokens (globals.css) — nothing here hardcodes a color that isn't already a
// token, so a future palette change only touches globals.css.
//
// Phase 4B: added a hover state — the border and glow both brighten toward
// the panel's own accent token (cyan by default), and the card lifts
// slightly. Border color moved from inline style to a Tailwind arbitrary
// class (still `var(--cockpit-glass-border)`, no hardcoded color) so the
// `hover:` variant can take over via plain CSS, no extra JS needed for it.

export type CockpitGlowState = 'cyan' | 'blue' | 'alert' | 'success' | 'none';
export type CockpitStatusTone = 'ok' | 'warn' | 'critical' | 'neutral';

export interface CockpitStatus {
  label: string;
  tone?: CockpitStatusTone;
}

export interface CockpitPanelProps {
  title?: string;
  subtitle?: string;
  status?: CockpitStatus;
  glow?: CockpitGlowState;
  children?: ReactNode;
  className?: string;
}

const GLOW_COLOR: Record<Exclude<CockpitGlowState, 'none'>, string> = {
  cyan: 'var(--cockpit-glow-cyan)',
  blue: 'var(--cockpit-glow-blue)',
  alert: 'var(--cockpit-glow-alert)',
  success: 'var(--cockpit-glow-success)',
};

// Static, fully-written class strings (not built via template interpolation)
// so Tailwind's build-time scanner can see and generate every variant.
const HOVER_BORDER: Record<CockpitGlowState, string> = {
  cyan: 'hover:border-[var(--cockpit-glow-cyan)]',
  blue: 'hover:border-[var(--cockpit-glow-blue)]',
  alert: 'hover:border-[var(--cockpit-glow-alert)]',
  success: 'hover:border-[var(--cockpit-glow-success)]',
  none: 'hover:border-[var(--cockpit-glow-cyan)]',
};

const STATUS_DOT: Record<CockpitStatusTone, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  critical: 'bg-red-400',
  neutral: 'bg-slate-500',
};

export default function CockpitPanel({
  title,
  subtitle,
  status,
  glow = 'none',
  children,
  className = '',
}: CockpitPanelProps) {
  const [hovered, setHovered] = useState(false);
  const accentColor = glow !== 'none' ? GLOW_COLOR[glow] : GLOW_COLOR.cyan;
  const hasHeader = Boolean(title || subtitle || status);

  const restShadow = glow !== 'none'
    ? `var(--cockpit-panel-shadow), 0 0 32px ${accentColor}`
    : 'var(--cockpit-panel-shadow)';
  const hoverShadow = `var(--cockpit-panel-shadow), 0 0 48px ${accentColor}`;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative rounded-2xl border border-[var(--cockpit-glass-border)] backdrop-blur-md p-5 transition-[transform,border-color,box-shadow] hover:-translate-y-1 ${HOVER_BORDER[glow]} ${className}`}
      style={{
        background: 'var(--cockpit-glass-bg)',
        boxShadow: hovered ? hoverShadow : restShadow,
        transitionDuration: 'var(--cockpit-transition-speed)',
      }}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {title && (
              <h3
                className="truncate text-white"
                style={{
                  fontSize: 'var(--cockpit-founder-heading-size)',
                  fontWeight: 'var(--cockpit-founder-heading-weight)',
                  letterSpacing: 'var(--cockpit-founder-heading-tracking)',
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                className="mt-0.5 truncate uppercase text-slate-500"
                style={{
                  fontSize: 'var(--cockpit-intel-label-size)',
                  fontWeight: 'var(--cockpit-intel-label-weight)',
                  letterSpacing: 'var(--cockpit-intel-label-tracking)',
                }}
              >
                {subtitle}
              </p>
            )}
          </div>

          {status && (
            <div className="flex items-center gap-1.5 shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-1">
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${STATUS_DOT[status.tone ?? 'neutral']}`}
                style={{ animationDuration: 'var(--cockpit-pulse-speed)' }}
              />
              <span className="text-[10px] text-slate-300 whitespace-nowrap">{status.label}</span>
            </div>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
