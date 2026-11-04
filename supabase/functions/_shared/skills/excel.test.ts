import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildWorkbook, readWorkbook, safeFilename, validateSpec } from './excel.ts';

Deno.test('builds a real xlsx that opens and keeps values, formats and a totals formula', async () => {
  const bytes = await buildWorkbook({
    filename: 'Acme plan',
    sheets: [{ name: 'Plan', columns: [{ header: 'Item' }, { header: 'Amount', format: 'inr' }], rows: [['A', 100], ['B', 250]], totals: true }],
    notes: 'Assumption: illustrative figures',
  });
  assertEquals([bytes[0], bytes[1]], [0x50, 0x4b]); // zip header = real xlsx
  const sheets = await readWorkbook(bytes);
  assertEquals(sheets.map((s) => s.name), ['Plan', 'Notes']);
  assertEquals(sheets[0].rows[0], ['Item', 'Amount']);
  assertEquals(sheets[0].rows[2], ['B', 250]);
  const total = sheets[0].rows[3] as unknown[];
  assertEquals(total[0], 'Total');
  assertEquals((total[1] as { formula: string }).formula, 'SUM(B2:B3)');
});

Deno.test('explicit formulas are kept (leading = removed)', async () => {
  const sheets = await readWorkbook(await buildWorkbook({ sheets: [{ name: 'S', columns: [{ header: 'x' }, { header: 'y' }], rows: [[2, { formula: '=A2*10' }]] }] }));
  assertEquals((sheets[0].rows[1][1] as { formula: string }).formula, 'A2*10');
});

Deno.test('rejects bad specs with clear reasons', async () => {
  assertEquals(validateSpec({ sheets: [] }), ['sheets: at least one sheet is required']);
  const errs = validateSpec({ sheets: [{ name: 'a/b', columns: [], rows: [] }, { name: 'A/B', columns: [{ header: 'h' }], rows: [] }] });
  assert(errs.some((e) => e.includes('name: max 31')));
  assert(errs.some((e) => e.includes('columns: required')));
  await assertRejects(() => buildWorkbook({ sheets: [] }), Error, 'invalid workbook spec');
});

Deno.test('safe filenames', () => {
  assertEquals(safeFilename('Q3 / plan.xlsx'), 'Q3  plan.xlsx');
  assertEquals(safeFilename(''), 'fkaios-workbook.xlsx');
});
