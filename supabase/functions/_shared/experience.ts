// ONE BRAIN step 2 — real work experience for the brain: what FKAIOS was asked to do (objectives)
// and how it actually went (completed / failed / waiting, with the recorded result).
// Read with the service role (orchestrator_requests is not readable by the founder's JWT under RLS).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface Experience { total: number; byStatus: Record<string, number>; recent: { request: string; status: string; result: string }[] }

export async function getObjectiveExperience(days = 30, max = 10): Promise<Experience | null> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  const db = createClient(url, key);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await db.from('orchestrator_requests')
    .select('raw_request, status, result_summary, created_at').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(200);
  if (error || !data) return null;
  const byStatus: Record<string, number> = {};
  for (const r of data) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  // Show finished work first (completed + failed teach the most), then the rest.
  const finished = data.filter((r) => r.status === 'completed' || r.status === 'failed');
  const recent = [...finished, ...data.filter((r) => !finished.includes(r))].slice(0, max).map((r) => ({
    request: String(r.raw_request || '').replace(/\s+/g, ' ').slice(0, 160),
    status: r.status,
    result: String(r.result_summary || '').replace(/\s+/g, ' ').slice(0, 220),
  }));
  return { total: data.length, byStatus, recent };
}

export function experienceText(e: Experience | null, days = 30): string {
  if (!e || !e.total) return `Objectives (${days}d): none`;
  const counts = Object.entries(e.byStatus).map(([s, n]) => `${n} ${s}`).join(', ');
  return `Objectives given to FKAIOS (${days}d): ${e.total} (${counts})\n` +
    e.recent.map((r, i) => `  ${i + 1}. [${r.status}] ${r.request}${r.result ? ` -> ${r.result}` : ''}`).join('\n');
}
