import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { recalledRows, recallTerms } from './brain-recall.ts';

Deno.test('v3 rows are cut to the caller limit with short excerpts', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, pdf_page: i + 1, excerpt: 'x'.repeat(4200) }));
  const out = recalledRows(rows, 5);
  assertEquals(out.length, 5);
  assertEquals(out[0], { title: 'T0', page: 1, excerpt: 'x'.repeat(1500) });
});

Deno.test('missing fields are safe', () => {
  assertEquals(recalledRows([{}], 3), [{ title: '', page: null, excerpt: '' }]);
});

Deno.test('search terms drop Hinglish/English stop words', () => {
  assertEquals(recallTerms('GoMax ka dealer scheme kya hai?'), ['gomax', 'dealer', 'scheme']);
});
