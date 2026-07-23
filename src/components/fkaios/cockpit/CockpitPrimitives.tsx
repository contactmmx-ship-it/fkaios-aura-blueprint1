'use client';
import { ReactNode } from 'react';

// Small shared typography primitives for the FKAIOS cockpit UI, built on the
// Phase 1 tokens (globals.css). Pure presentation — no data, no fetching.
// Exported separately from CockpitPanel so any cockpit panel's children can
// reuse the same label/value styling without re-declaring the inline styles.

export function CockpitLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`uppercase text-slate-500 ${className}`}
      style={{
        fontSize: 'var(--cockpit-intel-label-size)',
        fontWeight: 'var(--cockpit-intel-label-weight)',
        letterSpacing: 'var(--cockpit-intel-label-tracking)',
      }}
    >
      {children}
    </p>
  );
}

export function CockpitStatValue({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`text-white tabular-nums ${className}`}
      style={{
        fontSize: 'var(--cockpit-data-emphasis-size)',
        fontWeight: 'var(--cockpit-data-emphasis-weight)',
      }}
    >
      {children}
    </p>
  );
}
