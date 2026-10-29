import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { criticInput, draftMemoryBlock, draftMemoryQuery, makerInput, plannerInput } from './draft-memory.ts';

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

Deno.test('figures deep in a recalled page reach the Maker (29 Oct: 15% at char 775 was cut at 500)', () => {
  const page = 'x'.repeat(770) + ' 15% TD, 5 free bags per 50, 4% CD';
  const block = draftMemoryBlock([{ title: 'Drive: GoMax — Dealer Scheme FY26-27 (Final).docx', page: 1, excerpt: page }]);
  assert(block.includes('15% TD, 5 free bags per 50, 4% CD'));
});

Deno.test('Critic input unchanged when nothing was recalled', () => {
  assertEquals(criticInput('B', 'OUT', ''), "Brief: B\n\nMaker's output:\nOUT");
});

Deno.test('Critic sees the same memory as the Maker (29 Oct: real 15% TD rejected as fabricated)', () => {
  const memory = draftMemoryBlock([{ title: 'Drive: GoMax — Dealer Scheme FY26-27 (Final).docx', page: 1, excerpt: '15% TD, 4% CD' }]);
  const input = criticInput('GoMax one-pager with [XX%] placeholders', '15% TD [Source: GoMax]', memory);
  assert(input.startsWith("Brief: GoMax one-pager"));
  assert(input.includes('[Drive: GoMax — Dealer Scheme FY26-27 (Final).docx, p.1] 15% TD, 4% CD'));
  assert(input.includes('THE MAKER WAS GIVEN THIS'));
  assert(input.includes('override placeholders') && input.includes('invented'));
});

Deno.test('planner input unchanged when nothing was recalled', () => {
  assertEquals(plannerInput('Client: GoMax\nFounder\'s request: x', ''), 'Client: GoMax\nFounder\'s request: x');
});

Deno.test('planner gets memory figures so agreed numbers are not turned into placeholders (29 Oct run 4)', () => {
  const memory = draftMemoryBlock([{ title: 'Drive: GoMax — Dealer Scheme FY26-27 (Final).docx', page: 1, excerpt: '15% TD, 4% CD' }]);
  const input = plannerInput("Founder's request: the exact figures we agreed", memory);
  assert(input.includes('15% TD, 4% CD') && input.includes('placeholders only for what neither'));
});

Deno.test('29 Oct planner query: founder request + client finds subject terms', () => {
  const q = draftMemoryQuery({ title: 'TEST — Draft Studio memory acceptance (29 Oct)', client_name: 'GoMax',
    brief: 'One-page GoMax dealer scheme summary for a new dealer: trade discount, cash discount and the free-bags rule' });
  const first6 = [...new Set((q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2))].slice(0, 6);
  for (const w of ['gomax', 'dealer', 'scheme']) assert(first6.includes(w), `${w} missing from ${first6}`);
});
