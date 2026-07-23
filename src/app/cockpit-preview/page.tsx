import type { Metadata } from 'next';
import FounderCockpit from '@/components/fkaios/cockpit/FounderCockpit';

// /cockpit-preview — TEMPORARY internal preview route (Phase 4A).
// Exists only so the FKAIOS Phase 5 CEO Control Room shell can be visually
// inspected in a real browser before any data wiring or routing changes.
// Not linked from AppShell navigation, not the default route, not part of
// the sitemap — and already excluded from crawling by robots.ts's
// disallow-by-default rule (only /franchise and /products are allowed).
// No auth, no backend calls, no Supabase client — FounderCockpit itself has
// none of those yet either.

export const metadata: Metadata = {
  title: 'FKAIOS Cockpit Preview (internal)',
  robots: { index: false, follow: false },
};

export default function CockpitPreviewPage() {
  return <FounderCockpit />;
}
