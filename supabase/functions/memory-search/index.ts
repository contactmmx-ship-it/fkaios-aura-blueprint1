// memory-search — ONE BRAIN step 2 (28 Oct 2026). Lets the founder see and search the one memory
// (fkaios_knowledge_sources/pages: 622 ChatGPT work chats + future documents) from the Knowledge Vault tab.
// Same recall the brain uses (SQL fkaios_recall via _shared/brain-recall.ts). Signed-in users only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recall, recallTerms } from '../_shared/brain-recall.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey' };
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
  if (!signedIn(req.headers.get('Authorization'), url)) return json({ error: 'Unauthorized' }, 401);
  try {
    const { action = 'search', query = '' } = await req.json().catch(() => ({}));
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (action === 'stats') {
      const [{ count: sources }, { count: pages }, { data: byProject }] = await Promise.all([
        db.from('fkaios_knowledge_sources').select('id', { count: 'exact', head: true }),
        db.from('fkaios_knowledge_pages').select('id', { count: 'exact', head: true }),
        db.rpc('fkaios_memory_projects'),
      ]);
      return json({ sources, pages, byProject: byProject || [] });
    }
    const q = String(query).slice(0, 300);
    if (!recallTerms(q).length) return json({ results: [] });
    return json({ results: await recall(q, 8) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
