// ONE BRAIN step 1 — shared recall over the FKAIOS knowledge library (fkaios_knowledge_sources/pages:
// 622 ChatGPT work chats + any future documents). Every brain surface should call recall() before reasoning,
// so all tabs remember from the same memory. Backed by SQL fkaios_recall(text[], int) (service role only).
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

export interface Recalled { title: string; page: number | null; excerpt: string }

export async function recall(question: string, limit = 5): Promise<Recalled[]> {
  const terms = recallTerms(question);
  if (!terms.length) return [];
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return [];
  const db = createClient(url, key);
  const { data, error } = await db.rpc('fkaios_recall', { p_terms: terms, p_limit: limit });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({ title: r.title, page: r.pdf_page ?? null, excerpt: String(r.excerpt || '') }));
}

export function recallBlock(items: Recalled[]): string {
  if (!items.length) return '';
  return `\n\n=== FROM THE FOUNDER'S PAST WORK (memory recall; may be outdated; cite the chat title when you use it) ===\n` +
    items.map((r, i) => `${i + 1}. [${r.title}${r.page ? `, p.${r.page}` : ''}] ${r.excerpt.slice(0, 400)}`).join('\n') +
    `\n=== END MEMORY RECALL ===`;
}
