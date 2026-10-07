// VAULT-ENGINE v3 — fix: pgvector column requires stringified vector via supabase-js.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-vault-secret', 'Content-Type': 'application/json' };
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

const session = new Supabase.ai.Session('gte-small');

async function embed(text: string): Promise<string> {
  const out = await session.run(text, { mean_pool: true, normalize: true });
  return JSON.stringify(Array.from(out as Float32Array | number[]));
}

function chunkText(text: string, target = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= target) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + target, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const lastBreak = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('।'));
      if (lastBreak > target * 0.5) end = start + lastBreak + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks.filter(c => c.length > 20);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const t0 = Date.now();
  try {
    const secret = Deno.env.get('HEARTBEAT_SECRET');
    const provided = req.headers.get('x-vault-secret') ?? new URL(req.url).searchParams.get('secret');
    if (secret && provided !== secret) return err('Unauthorized', 401);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!);
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? 'status';

    async function logExec(action: string, status: string, inputSummary: string, outputSummary: string, error?: string) {
      try {
        await db.from('execution_log').insert({ function_name: 'vault-engine', department_code: 'RND', action, status, input_summary: inputSummary.slice(0, 500), output_summary: outputSummary.slice(0, 500), error: error?.slice(0, 500) ?? null, latency_ms: Date.now() - t0 });
      } catch (_) {}
    }

    async function ingestOne(doc: { id: string; brand_id: string | null; title: string | null; content: string | null }) {
      const content = (doc.content ?? '').trim();
      if (!content) return { document_id: doc.id, chunks: 0, skipped: 'empty content' };
      await db.from('brain_knowledge_chunks').delete().eq('document_id', doc.id);
      const pieces = chunkText(content);
      let inserted = 0;
      let lastError: string | null = null;
      for (let i = 0; i < pieces.length; i++) {
        const withTitle = doc.title ? `[${doc.title}]\n${pieces[i]}` : pieces[i];
        const embedding = await embed(withTitle);
        const { error: insErr } = await db.from('brain_knowledge_chunks').insert({
          document_id: doc.id, brand_id: doc.brand_id, chunk_index: i,
          text: pieces[i], embedding, source: 'vault-engine', token_count: Math.ceil(pieces[i].length / 4),
        });
        if (insErr) { lastError = insErr.message; } else { inserted++; }
      }
      return { document_id: doc.id, title: doc.title, chunks: inserted, ...(lastError ? { last_error: lastError } : {}) };
    }

    if (action === 'ingest_document') {
      if (!body.document_id) return err('document_id required', 400);
      const { data: doc, error: dErr } = await db.from('brain_knowledge_documents').select('id, brand_id, title, content').eq('id', body.document_id).single();
      if (dErr || !doc) return err(`Document not found: ${dErr?.message}`, 404);
      const result = await ingestOne(doc);
      await logExec('ingest_document', result.chunks > 0 ? 'success' : 'failure', `doc ${doc.id}`, `${result.chunks} chunks embedded`, (result as any).last_error);
      return ok(result);
    }

    if (action === 'ingest_all') {
      const { data: docs, error: dErr } = await db.from('brain_knowledge_documents').select('id, brand_id, title, content').eq('status', 'active');
      if (dErr) return err(dErr.message);
      const results = [];
      for (const doc of docs ?? []) results.push(await ingestOne(doc));
      const total = results.reduce((s, r) => s + (r.chunks ?? 0), 0);
      await logExec('ingest_all', total > 0 ? 'success' : 'failure', `${docs?.length ?? 0} documents`, `${total} chunks embedded`);
      return ok({ documents: results.length, total_chunks: total, results });
    }

    if (action === 'search') {
      if (!body.query) return err('query required', 400);
      const queryEmbedding = await embed(body.query);
      const { data: matches, error: mErr } = await db.rpc('match_knowledge_chunks', {
        query_embedding: queryEmbedding,
        match_count: body.match_count ?? 5,
        filter_brand_id: body.brand_id ?? null,
      });
      if (mErr) return err(`Search failed: ${mErr.message}`);
      await logExec('search', 'success', body.query.slice(0, 200), `${matches?.length ?? 0} matches, top similarity ${matches?.[0]?.similarity?.toFixed(3) ?? 'n/a'}`);
      return ok({ query: body.query, matches: matches ?? [] });
    }

    const { count: docCount } = await db.from('brain_knowledge_documents').select('id', { count: 'exact', head: true }).eq('status', 'active');
    const { count: chunkCount } = await db.from('brain_knowledge_chunks').select('id', { count: 'exact', head: true });
    const { count: embeddedCount } = await db.from('brain_knowledge_chunks').select('id', { count: 'exact', head: true }).not('embedding', 'is', null);
    return ok({ active_documents: docCount ?? 0, chunks: chunkCount ?? 0, embedded_chunks: embeddedCount ?? 0 });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});
