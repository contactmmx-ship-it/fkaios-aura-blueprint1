// ONE BRAIN step 1 — shared recall over the FKAIOS knowledge library (fkaios_knowledge_sources/pages:
// 622 ChatGPT work chats + any future documents). Every brain surface should call recall() before reasoning,
// so all tabs remember from the same memory. Backed by SQL fkaios_memory_search(text[], int) (service role only).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STOP = new Set(('a an the and or but if then so of to in on at for from by with about into over is are was were be been being ' +
  'do does did done have has had i me my we our you your he she it they them this that these those what which who whom whose ' +
  'when where why how can could should would will shall may might must not no yes please tell show give get make let us ' +
  'kya hai hain ka ki ke ko se me mein par aur ya bhi tha thi the ho hoga kaise kyun kab kaun koi kuch yeh woh ye wo ' +
  'batao bata karo kar diya liya hua hui').split(' '));
const ALIAS: Record<string, string> = { chickn: 'chick', chicken: 'chick' };

export function recallTerms(question: string, maxTerms = 6): string[] {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((w) => w.length > 2 && !STOP.has(w)).map((w) => ALIAS[w] || w);
  return [...new Set(words)].slice(0, maxTerms);
}

export interface Recalled { title: string; page: number | null; excerpt: string; sourceUrl?: string }

export async function recall(question: string, limit = 5, maxChars = 1500): Promise<Recalled[]> {
  const terms = recallTerms(question);
  if (!terms.length) return [];
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return [];
  const db = createClient(url, key);
  // 29 Oct 2026: same search as Give an Objective (fkaios_memory_search = v3: word rarity, brand anchor,
  // figures). The older fkaios_recall ranked long ChatGPT pages above register entries and documents and
  // missed broad questions (12-query test: v3 found 12/12, fkaios_recall 10/12). Rollback: rpc 'fkaios_recall'.
  const { data, error } = await db.rpc('fkaios_memory_search', { p_terms: terms, p_limit: limit });
  if (error || !data) return [];
  const rows = data as any[];
  const recalled = recalledRows(rows, limit, maxChars);
  // Original links are stored on the source record's storage_path when available.
  // Resolve them read-only; project_hub/bucket paths are deliberately not exposed as URLs.
  const ids = [...new Set(rows.slice(0, recalled.length).map((r) => String(r.source_id || '')).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return recalled;
  const { data: sources } = await db.from('fkaios_knowledge_sources').select('id, storage_path, ingestion_report').in('id', ids);
  const urls = new Map((sources || []).map((s: SourceLinkFields & { id: string }) => [s.id, sourceLink(s)]));
  return recalled.map((item, i) => {
    const link = urls.get(String(rows[i]?.source_id || ''));
    return link ? { ...item, sourceUrl: link } : item;
  });
}

export interface SourceLinkFields { storage_path?: string | null; ingestion_report?: Record<string, unknown> | null }
/** The original's web link: storage_path when it is a URL (Drive, GitHub, artifacts), else ingestion_report.source_url
 *  (29 Oct: the 622 ChatGPT chats -> chatgpt.com/c/<id>; their storage_path stays the archive provenance). */
export function sourceLink(s: SourceLinkFields | null | undefined): string | undefined {
  const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);
  if (isUrl(s?.storage_path)) return s!.storage_path as string;
  const alt = s?.ingestion_report?.source_url;
  return isUrl(alt) ? alt : undefined;
}

/** v3 returns at least 8 rows and whole figure pages; keep the caller's limit and a readable excerpt. */
export function recalledRows(rows: { title?: string; pdf_page?: number | null; excerpt?: string }[], limit: number, maxChars = 1500): Recalled[] {
  return rows.slice(0, Math.max(1, limit)).map((r) => ({ title: String(r.title || ''), page: r.pdf_page ?? null, excerpt: String(r.excerpt || '').slice(0, maxChars) }));
}

/** excerptChars: 400 keeps other callers unchanged; Brain Chat passes 1,500 because figures often sit past
 *  character 400 (29 Oct: GoMax scheme figures at 775–932 were cut, so Brain Chat cited the doc without them). */
export function recallBlock(items: Recalled[], excerptChars = 400): string {
  if (!items.length) return '';
  return `\n\n=== FROM THE FOUNDER'S PAST WORK (memory recall; may be outdated; cite the chat title when you use it) ===\n` +
    items.map((r, i) => `${i + 1}. [${r.title}${r.page ? `, p.${r.page}` : ''}]${r.sourceUrl && /^https?:\/\//i.test(r.sourceUrl) ? ` (source: ${r.sourceUrl})` : ''} ${r.excerpt.slice(0, excerptChars)}`).join('\n') +
    `\n=== END MEMORY RECALL ===`;
}
