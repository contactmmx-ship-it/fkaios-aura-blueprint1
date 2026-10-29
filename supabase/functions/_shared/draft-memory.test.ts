import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { draftMemoryBlock, draftMemoryQuery, makerInput } from './draft-memory.ts';

Deno.test('query is the subject: client, brief heading line, title, minus task words; body only as fallback', () => {
  assertEquals(draftMemoryQuery({ title: 'Chaat Masters brief', client_name: null, brief: 'franchise fee\nlong body text' }), 'franchise fee Chaat Masters');
  assertEquals(draftMemoryQuery({ title: 'New deck', client_name: null, brief: '\n# Project Brief\nfranchise fee' }), 'franchise fee');
});

Deno.test('29 Oct acceptance case: subject words reach recall terms, test-title noise does not', () => {
  const q = draftMemoryQuery({ title: 'TEST — Draft Studio memory acceptance (29 Oct)', client_name: 'GoMax',
    brief: '# Project Brief: GoMax New Dealer Scheme Summary\n\n## 1. Objective\nCreate a clear one-page summary' });
  const first6 = [...new Set((q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2))].slice(0, 6); // as recallTerms
  assertEquals(first6, ['gomax', 'dealer', 'scheme']);
  for (const w of ['gomax', 'dealer', 'scheme']) assert(first6.includes(w), `${w} missing from ${first6}`);
  for (const w of ['test', 'studio', 'acceptance']) assert(!first6.includes(w), `${w} should not lead`);
});

Deno.test('no recall -> no memory block, maker input unchanged from before', () => {
  assertEquals(draftMemoryBlock([]), '');
  assertEquals(makerInput('Make a deck', null, ''), 'Brief: Make a deck\nThis is the first draft.');
});

Deno.test('recalled sources reach the Maker with their titles for citation', () => {
  const block = draftMemoryBlock([{ title: 'Drive: GoMax — Dealer Scheme FY26-27 (Final).docx', page: 1, excerpt: '15% TD,\n 4% CD' }]);
  const input = makerInput('GoMax dealer brochure', 'add numbers', block);
  assert(input.startsWith('Brief: GoMax dealer brochure\nPrevious Critic feedback to address: add numbers'));
  assert(input.includes('[Drive: GoMax — Dealer Scheme FY26-27 (Final).docx, p.1] 15% TD, 4% CD'));
  assert(input.includes('name the source'));
});
