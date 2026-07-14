import type { Metadata } from 'next';

// SEO for the FRANCHISE front door. Sales channel: organic search.
// A prospective franchisee searching "Mr Chick'n franchise cost" or "chaat
// franchise India investment" is EXACTLY the inbound lead that can clear BANT —
// they arrive with budget, city and intent already formed. Until now this page
// had no title, no description and no structured data: invisible to Google.
//
// TRUTH: no claim here that is not in the database. No invented ROI, no invented
// payback period, no fabricated franchisee count.

export const metadata: Metadata = {
  title: 'Franchise Opportunities in India | Franchise Kart',
  description:
    'Explore franchise opportunities across QSR, furniture, paints, diagnostics and retail — with real investment ranges. Share your details and our team will contact you directly.',
  keywords: [
    'franchise opportunity India',
    'franchise for sale India',
    'QSR franchise India',
    'food franchise investment',
    'franchise consultancy India',
    'take a franchise',
  ],
  alternates: { canonical: 'https://fkaios-aura-blueprint1.vercel.app/franchise' },
  openGraph: {
    title: 'Franchise Opportunities in India | Franchise Kart',
    description:
      'Real brands, real investment ranges. Tell us your city and budget — we only take it forward if the opportunity genuinely fits you.',
    url: 'https://fkaios-aura-blueprint1.vercel.app/franchise',
    siteName: 'Franchise Kart',
    locale: 'en_IN',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Franchise Kart',
  description:
    'Franchise consultancy and brand development. Connects prospective franchisees with franchise brands across QSR, retail, furniture, paints and diagnostics in India.',
  areaServed: 'IN',
  url: 'https://fkaios-aura-blueprint1.vercel.app/franchise',
};

export default function FranchiseLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSONLD) }}
      />
      {children}
    </>
  );
}
