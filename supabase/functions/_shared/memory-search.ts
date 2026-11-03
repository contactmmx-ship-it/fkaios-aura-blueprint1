// Founder-memory search runner for vault-engine (3 Nov 2026).
//
// Why: GoMax objective 5b312395 was BLOCKED as "no verified source" although
// founder memory holds the GoMax register, scheme and P&L pages. Live logs show
// the memory SQL (fkaios_memory_search) hit the 8-second statement timeout at
// 12:04:28-12:04:57 UTC. vault-engine ignored the RPC error and answered
// "success, 0 matches", so the task was judged to have no data source.
//
// Rule here: a memory search that FAILED is never reported as a search that
// found nothing. A failed term set is retried once with fewer terms (less work
// for the database); if every term set still fails, the caller must return an
// error so the dispatcher and the job queue retry instead of concluding
// "no data". Pure function: the RPC is injected, so it is unit-tested offline.

export const MEMORY_RETRY_MAX_TERMS = 5;

export type MemoryRpc = (terms: string[], limit: number) => Promise<{ data: unknown; error: unknown }>;

export interface MemoryTermSetResult { terms: string[]; rows: Record<string, unknown>[] }
export interface MemorySearchRun { sets: MemoryTermSetResult[]; failures: string[]; attempted: number; failed: number }

function errorText(error: unknown): string {
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") return (error as Record<string, unknown>).message as string;
  return String(error);
}

export async function runMemorySearch(rpc: MemoryRpc, termSets: string[][], limit: number): Promise<MemorySearchRun> {
  const run: MemorySearchRun = { sets: [], failures: [], attempted: 0, failed: 0 };
  for (const original of termSets) {
    if (!original.length) continue;
    run.attempted++;
    let terms = original;
    let res: { data: unknown; error: unknown };
    try { res = await rpc(terms, limit); } catch (e) { res = { data: null, error: e }; }
    if (res.error && original.length > MEMORY_RETRY_MAX_TERMS) {
      terms = original.slice(0, MEMORY_RETRY_MAX_TERMS);
      try { res = await rpc(terms, limit); } catch (e) { res = { data: null, error: e }; }
    }
    if (res.error) {
      run.failed++;
      run.failures.push(errorText(res.error).slice(0, 200));
      continue;
    }
    const rows = Array.isArray(res.data) ? res.data.filter((r) => r && typeof r === "object") as Record<string, unknown>[] : [];
    run.sets.push({ terms, rows });
  }
  return run;
}

/** True when memory was searched and every attempt failed: the answer is unknown, not "nothing found". */
export function memorySearchFailed(run: MemorySearchRun): boolean {
  return run.attempted > 0 && run.failed === run.attempted;
}
