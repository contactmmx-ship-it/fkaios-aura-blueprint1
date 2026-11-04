// skill-excel — FKAIOS skill "make Excel" (4 Nov 2026). POST a JSON workbook spec, get a real .xlsx back.
// Writer = ExcelJS (MIT) via _shared/skills/excel.ts. No AI call, no paid service, no database writes.
// Auth: a signed-in FKAIOS user, or the server heartbeat secret (for engines and acceptance tests).
import { buildWorkbook, readWorkbook, safeFilename, validateSpec, type WorkbookSpec } from '../_shared/skills/excel.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, x-heartbeat-secret' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function signedIn(auth: string | null, supabaseUrl: string): boolean {
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    const p = JSON.parse(atob(auth.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.iss === `${supabaseUrl}/auth/v1` && (!p.exp || p.exp > Date.now() / 1000);
  } catch { return false; }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const hb = Deno.env.get('HEARTBEAT_SECRET');
  const serverCall = !!hb && req.headers.get('x-heartbeat-secret') === hb;
  if (!serverCall && !signedIn(req.headers.get('Authorization'), Deno.env.get('SUPABASE_URL')!)) return json({ error: 'Unauthorized' }, 401);
  const body = (await req.json().catch(() => null)) as (WorkbookSpec & { format?: 'base64' | 'file' }) | null;
  if (!body) return json({ error: 'JSON body required' }, 400);
  const errors = validateSpec(body);
  if (errors.length) return json({ error: 'invalid workbook spec', details: errors }, 400);
  const bytes = await buildWorkbook(body);
  const filename = safeFilename(body.filename);
  if (body.format === 'file') {
    return new Response(bytes, { headers: { ...cors, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"` } });
  }
  // Proof the file opens: read it back before returning (Done = proof).
  const check = await readWorkbook(bytes);
  return json({ filename, bytes: bytes.length, sheets: check.map((s) => ({ name: s.name, rows: s.rows.length })), base64: toBase64(bytes) });
});
