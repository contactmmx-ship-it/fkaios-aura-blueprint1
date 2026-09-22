import type { Metadata } from 'next';
import AppShell from '@/components/fkaio/AppShell';

// /console — the Founder's real control surface.
//
// AppShell (src/components/fkaio/AppShell.tsx) has existed fully built and
// DB-backed since an earlier phase — real Supabase auth, and 23 pages
// including ApprovalsPage, GovernanceDashboard, DecisionCenter, Dashboard,
// RevenueDesk — but was never imported by any route (V1 Autonomous
// Completion mandate, Aura UI classification: "built but unmounted").
// This route is the mount point. Nothing in AppShell itself changed.
//
// Deliberately a new route, not a change to `/` (which currently renders
// bare FounderCockpit with no auth gate) — swapping root's behavior would
// add an unexpected login requirement to a URL that's open today. robots.ts
// already disallows everything except /franchise and /products by default,
// so this route is excluded from crawling with no further change needed.

export const metadata: Metadata = {
  title: 'FKAIOS Console',
  robots: { index: false, follow: false },
};

export default function ConsolePage() {
  return <AppShell />;
}
