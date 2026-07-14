import type { MetadataRoute } from 'next';

// SECURITY + SEO, in one file.
//
// The ROOT of this deployment is the private FKAIOS enterprise operating system —
// governance, revenue, approvals, the AI workforce, the Chairman's own console.
// It must NEVER be indexed. Google finding "/" would surface an internal command
// centre in search results.
//
// Only the two COMMERCIAL FRONT DOORS are crawlable:
//   /franchise — prospective franchisees
//   /products  — software / white-label buyers
//
// Disallow-by-default, allow-by-exception. The safe direction to fail.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // Everything is off-limits...
        disallow: '/',
        // ...except the two doors that exist to be found.
        allow: ['/franchise', '/products'],
      },
    ],
    sitemap: 'https://fkaios-aura-blueprint1.vercel.app/sitemap.xml',
  };
}
