import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { recalledRows, recallTerms, recallBlock, sourceLink, withRetry } from './brain-recall.ts';

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

Deno.test('recall block includes a real source URL when present', () => {
  const block = recallBlock([{ title: 'GoMax Dealer Scheme', page: 1, excerpt: '15% trade discount', sourceUrl: 'https://drive.google.com/file/d/example' }]);
  assertEquals(block.includes('https://drive.google.com/file/d/example'), true);
  assertEquals(block.includes('GoMax Dealer Scheme, p.1'), true);
});

Deno.test('recall block does not expose non-URL storage paths as links', () => {
  const block = recallBlock([{ title: 'Steel Era', page: 1, excerpt: 'Project record', sourceUrl: 'project_hub#abc' }]);
  assertEquals(block.includes('project_hub#abc'), false);
});

Deno.test('Brain Chat gets figures deep in a page; default callers keep 400 chars (29 Oct GoMax)', () => {
  const item = { title: 'Drive: GoMax — Dealer Scheme FY26-27 (Final).docx', page: 1, excerpt: 'x'.repeat(770) + ' 15% TD, every 50 bags = 5 free, 4% CD' };
  assertEquals(recallBlock([item], 1500).includes('15% TD, every 50 bags = 5 free, 4% CD'), true);
  assertEquals(recallBlock([item]).includes('15% TD'), false);
});

Deno.test('source link: URL storage_path first, else ingestion_report.source_url, never internal paths', () => {
  assertEquals(sourceLink({ storage_path: 'https://drive.google.com/file/d/x' }), 'https://drive.google.com/file/d/x');
  assertEquals(sourceLink({ storage_path: 'chatgpt-archive.zip#abc.md', ingestion_report: { source_url: 'https://chatgpt.com/c/abc' } }), 'https://chatgpt.com/c/abc');
  assertEquals(sourceLink({ storage_path: 'project_hub#abc', ingestion_report: { chat_id: 'x' } }), undefined);
  assertEquals(sourceLink({ storage_path: 'project_hub#abc', ingestion_report: { source_url: 'javascript:alert(1)' } }), undefined);
  assertEquals(sourceLink(null), undefined);
});

Deno.test('callers can ask for longer excerpts (Brain Chat: whole GoMax rate table)', () => {
  const rows = [{ title: 'T', pdf_page: 1, excerpt: 'x'.repeat(2400) + ' TOP DEALER ₹209' }];
  assertEquals(recalledRows(rows, 1)[0].excerpt.includes('₹209'), false);
  assertEquals(recalledRows(rows, 1, 2600)[0].excerpt.includes('₹209'), true);
});

Deno.test('a failed search call is retried once, then the error is kept (29 Oct timeouts under load)', async () => {
  let calls = 0;
  const ok = await withRetry(async () => (++calls === 1 ? { error: 'statement timeout' } : { error: undefined, data: [1] }), 1, 1);
  assertEquals([calls, ok.error], [2, undefined]);
  calls = 0;
  const bad = await withRetry(async () => { calls++; return { error: 'statement timeout' }; }, 1, 1);
  assertEquals([calls, bad.error], [2, 'statement timeout']);
});
