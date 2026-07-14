import type { Metadata } from 'next';

// SEO for the AURA TECH front door. Sales channel: organic search.
// A business searching "white label franchise management software" or "lead
// qualification AI for franchise" is a LARGE-TICKET buyer — the only arithmetic
// that closes the ₹5 Cr gate (Strategy D). Until now this page was invisible.
//
// TRUTH: every product named here is SHIPPED and carries evidence in
// product_library (the schema physically refuses an asset without it). No
// vapourware, no roadmap items sold as inventory, no invented client logos.

export const metadata: Metadata = {
  title: 'Enterprise AI Software, Already Built | Aura Tech',
  description:
    'White-label and modular enterprise software running in production: inbound lead funnels with AI qualification, AI-assisted invoicing with a human approval gate, LLM cost tracking, and executive intelligence. Built for Indian businesses.',
  keywords: [
    'white label franchise software',
    'franchise management software India',
    'AI lead qualification software',
    'custom enterprise software India',
    'AI automation for business India',
    'white label SaaS India',
  ],
  alternates: { canonical: 'https://fkaios-aura-blueprint1.vercel.app/products' },
  openGraph: {
    title: 'Enterprise AI Software, Already Built | Aura Tech',
    description:
      'Systems we run in production ourselves — not mockups. Available white-label, as modules, or built to your requirement.',
    url: 'https://fkaios-aura-blueprint1.vercel.app/products',
    siteName: 'Aura Tech',
    locale: 'en_IN',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Aura Tech',
  description:
    'Enterprise software and AI systems: white-label inbound lead funnels with AI qualification, AI-assisted invoicing with human approval gates, LLM cost and execution tracking, and executive intelligence tooling.',
  areaServed: 'IN',
  url: 'https://fkaios-aura-blueprint1.vercel.app/products',
};

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
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
