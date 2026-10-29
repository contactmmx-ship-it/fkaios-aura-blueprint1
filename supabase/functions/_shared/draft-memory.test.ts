import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { draftMemoryBlock, draftMemoryQuery, makerInput } from './draft-memory.ts';

Deno.test('query joins title, client and brief, skipping blanks', () => {
  assertEquals(draftMemoryQuery({ title: 'Chaat Masters brief', client_name: null, brief: 'franchise fee' }), 'Chaat Masters brief franchise fee');
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
