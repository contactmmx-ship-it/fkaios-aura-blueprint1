// memory-search — ONE BRAIN step 2 (28 Oct 2026). Lets the founder see and search the one memory
// (fkaios_knowledge_sources/pages: 622 ChatGPT work chats + future documents) from the Knowledge Vault tab.
// Same recall the brain uses (SQL fkaios_recall via _shared/brain-recall.ts). Signed-in users only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recall, recallTerms, sourceLink } from '../_shared/brain-recall.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, x-heartbeat-secret' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function signedIn(auth: string | null, supabaseUrl: string): boolean {
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    const p = JSON.parse(atob(auth.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.iss === `${supabaseUrl}/auth/v1` && (!p.exp || p.exp > Date.now() / 1000);
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  // 29 Oct 2026: also the server-side heartbeat secret (same check as my-brain-engine), so retrieval acceptance
  // tests can run through this deployed service without a founder session. Read-only actions only.
  const hb = Deno.env.get('HEARTBEAT_SECRET');
  const serverTest = !!hb && req.headers.get('x-heartbeat-secret') === hb;
  if (!serverTest && !signedIn(req.headers.get('Authorization'), url)) return json({ error: 'Unauthorized' }, 401);
  try {
    const arguments_ = await req.json().catch(() => ({}));
    const { action = 'search', query = '' } = arguments_ as { action?: string; query?: string };
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (action === 'stats') {
      const [{ count: sources }, { count: pages }, { data: byProject }] = await Promise.all([
        db.from('fkaios_knowledge_sources').select('id', { count: 'exact', head: true }),
        db.from('fkaios_knowledge_pages').select('id', { count: 'exact', head: true }),
        db.rpc('fkaios_memory_projects'),
      ]);
      return json({ sources, pages, byProject: byProject || [] });
    }
    // 29 Oct 2026: browse + read, so the founder can SEE what the brain knows (AI World section,
    // recently added, a project's chats) instead of only a count and a search box.
    const body = arguments_ as Record<string, unknown>;
    if (action === 'browse') {
      const cols = 'id,title,project_ref,brand,created_at,page_count';
      const project = typeof body.project === 'string' ? body.project.slice(0, 10) : '';
      const [aiWorld, recent, list] = await Promise.all([
        db.from('fkaios_knowledge_sources').select(cols).eq('project_ref', 'W01').order('created_at', { ascending: false }).limit(60),
        db.from('fkaios_knowledge_sources').select(cols).not('title', 'like', 'ChatGPT chats index%').order('created_at', { ascending: false }).limit(15),
        project ? db.from('fkaios_knowledge_sources').select(cols).eq('project_ref', project).order('title').limit(300) : Promise.resolve({ data: [] }),
      ]);
      return json({ aiWorld: aiWorld.data || [], recent: recent.data || [], project: list.data || [] });
    }
    if (action === 'read') {
      const id = typeof body.source_id === 'string' ? body.source_id : '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'source_id required' }, 400);
      const [{ data: src }, { data: pages }] = await Promise.all([
        db.from('fkaios_knowledge_sources').select('id,title,project_ref,brand,created_at,page_count,storage_path,ingestion_report').eq('id', id).maybeSingle(),
        db.from('fkaios_knowledge_pages').select('pdf_page,text').eq('source_id', id).order('pdf_page').limit(40),
      ]);
      if (!src) return json({ error: 'not found' }, 404);
      const { storage_path: _p, ingestion_report: _r, ...source } = src as Record<string, unknown>;
      return json({ source: { ...source, source_url: sourceLink(src as any) ?? null }, pages: pages || [] });
    }
    const q = String(query).slice(0, 300);
    if (!recallTerms(q).length) return json({ results: [] });
    return json({ results: await recall(q, 8) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
