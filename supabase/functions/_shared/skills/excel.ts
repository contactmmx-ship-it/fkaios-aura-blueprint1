// Skill: make Excel (4 Nov 2026). First FKAIOS "hand" (Knowledge Pack §8).
// REUSE BEFORE BUILD: the Excel writer is ExcelJS (MIT, github.com/exceljs/exceljs) — not our own code.
// This file only turns a plain JSON spec into a workbook, so any engine/objective can ask for a real .xlsx.
import ExcelJS from 'npm:exceljs@4.4.0';

export type Cell = string | number | boolean | null | { formula: string };
export interface SheetSpec {
  name: string;
  columns: { header: string; key?: string; width?: number; format?: 'inr' | 'number' | 'percent' | 'date' | 'text' }[];
  rows: Cell[][];
  totals?: boolean; // adds a SUM row under every numeric/inr column
  freezeHeader?: boolean;
}
export interface WorkbookSpec { filename?: string; sheets: SheetSpec[]; notes?: string }

const FORMATS: Record<string, string> = { inr: '"₹"#,##,##0', number: '#,##0.##', percent: '0.0%', date: 'dd-mmm-yyyy' };
const MAX_SHEETS = 20, MAX_ROWS = 20000, MAX_COLS = 60;

export function validateSpec(spec: WorkbookSpec): string[] {
  const errors: string[] = [];
  if (!spec || !Array.isArray(spec.sheets) || spec.sheets.length === 0) return ['sheets: at least one sheet is required'];
  if (spec.sheets.length > MAX_SHEETS) errors.push(`sheets: max ${MAX_SHEETS}`);
  const names = new Set<string>();
  spec.sheets.forEach((s, i) => {
    const at = `sheets[${i}]`;
    if (!s?.name || typeof s.name !== 'string') errors.push(`${at}.name: required`);
    else {
      if (s.name.length > 31 || /[\[\]\*\?\/\\:]/.test(s.name)) errors.push(`${at}.name: max 31 chars, no []*?/\\:`);
      if (names.has(s.name.toLowerCase())) errors.push(`${at}.name: duplicate`);
      names.add(s.name.toLowerCase());
    }
    if (!Array.isArray(s?.columns) || s.columns.length === 0) errors.push(`${at}.columns: required`);
    else if (s.columns.length > MAX_COLS) errors.push(`${at}.columns: max ${MAX_COLS}`);
    if (!Array.isArray(s?.rows)) errors.push(`${at}.rows: required (can be empty)`);
    else if (s.rows.length > MAX_ROWS) errors.push(`${at}.rows: max ${MAX_ROWS}`);
    else s.rows.forEach((r, j) => { if (!Array.isArray(r)) errors.push(`${at}.rows[${j}]: must be an array`); });
  });
  return errors;
}

function colLetter(n: number): string { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

export async function buildWorkbook(spec: WorkbookSpec): Promise<Uint8Array> {
  const errors = validateSpec(spec);
  if (errors.length) throw new Error(`invalid workbook spec: ${errors.join('; ')}`);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FKAIOS';
  wb.created = new Date();
  for (const s of spec.sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.columns = s.columns.map((c, i) => ({ header: c.header, key: c.key || `c${i}`, width: c.width || Math.min(40, Math.max(10, c.header.length + 2)) }));
    for (const r of s.rows) ws.addRow(r.map((v) => (v && typeof v === 'object' && 'formula' in v ? { formula: String(v.formula).replace(/^=/, '') } : v)));
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    if (s.freezeHeader !== false) ws.views = [{ state: 'frozen', ySplit: 1 }];
    s.columns.forEach((c, i) => { const f = c.format && FORMATS[c.format]; if (f) ws.getColumn(i + 1).numFmt = f; });
    if (s.totals && s.rows.length) {
      const last = s.rows.length + 1;
      const cells: Cell[] = s.columns.map((c, i) => (i === 0 ? 'Total' : (c.format === 'inr' || c.format === 'number') ? { formula: `SUM(${colLetter(i)}2:${colLetter(i)}${last})` } : null));
      const row = ws.addRow(cells.map((v) => (v && typeof v === 'object' ? { formula: v.formula } : v)));
      row.font = { bold: true };
    }
  }
  if (spec.notes) { const n = wb.addWorksheet('Notes'); n.getColumn(1).width = 100; spec.notes.split('\n').forEach((l) => n.addRow([l])); }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** Read a workbook back (used by tests and by the verifier to prove the file opens). */
export async function readWorkbook(bytes: Uint8Array): Promise<{ name: string; rows: unknown[][] }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => rows.push((r.values as unknown[]).slice(1)));
    return { name: ws.name, rows };
  });
}

export function safeFilename(name?: string): string {
  const base = (name || 'fkaios-workbook').replace(/\.xlsx$/i, '').replace(/[^a-zA-Z0-9 _.-]/g, '').trim().slice(0, 80) || 'fkaios-workbook';
  return `${base}.xlsx`;
}
