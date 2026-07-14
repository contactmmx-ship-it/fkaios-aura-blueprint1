import type { MetadataRoute } from 'next';

// Sitemap contains ONLY the two commercial front doors.
// The internal enterprise OS at "/" is deliberately absent — it is not a page we
// want found, and listing it here would undo the robots.txt disallow.

const BASE = 'https://fkaios-aura-blueprint1.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${BASE}/franchise`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0, // The franchise funnel is the nearest path to a first rupee.
    },
    {
      url: `${BASE}/products`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9, // Large-ticket software buyers — the arithmetic that closes ₹5 Cr.
    },
  ];
}
