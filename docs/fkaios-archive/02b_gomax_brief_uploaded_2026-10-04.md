# GoMax brief and patch, uploaded by Rajeev on 4 Oct 2026 (verbatim; written in ChatGPT, used to start Claude Code session 210c0e58)

## CLAUDE_CODE_PROMPT_v2_corrected.md

We have confirmed the live production root cause. Do NOT repeat the earlier investigation or redesign FKAIOS.

## PRIMARY GOAL
Fix the production `work-engine.ts` bug, deploy through GitHub → Supabase CI, then let the EXISTING GoMax objective complete through the real FKAIOS pipeline.
Do NOT create a new objective. Do NOT manually change task/objective status. Do NOT fabricate evidence.
Success = `6217332e-8d33-49b6-b13e-74f74bf5405f` genuinely `COMPLETED`, with verified evidence, final output, visible in the FKAIOS Console.

# IDS
- Repo: `contactmmx-ship-it/fkaios-aura-blueprint1`
- Supabase: `nrlsqshkjuuwiovthrnb`
- Objective: `6217332e-8d33-49b6-b13e-74f74bf5405f` — "Analyze the current GoMax sales situation, identify 3 risks, recommend 3 actions, and produce a prioritized execution plan."
- Project: `122c558c-bdbf-45f7-a335-930b4795b094`
- Task 1: `2f73d6f8-30fe-4827-8e8c-68376aadcc32` (assigned)
- Task 2: `9bde6cad-2723-4393-ac9b-2dbbf41f1a40` (rework) — verified against live DB. Any version with `-439-` is a typo and not a valid UUID.
- AI job: `c3e64577-4f18-4851-aabd-8eb458e1aa79` (completed, type `work_engine_task`, payload.task_id = Task 1)

# CONFIRMED ROOT CAUSE
`supabase/functions/_shared/work-engine.ts` ~line 270 (inside `returnCompletedWork()`) contains literal `\n` text instead of line breaks. The comment + `openTasks` query + `completedJobs` query are one `//` line → commented out.
Live logs: `completedJobs is not defined` every minute from `founder-brain-tick` and `founder-objective`. `runObjectiveLoop()` calls `returnCompletedWork()` again near its end without try/catch → throws → tick returns `objectiveLoop: []`. Commit `b461704` IS deployed; the bug is in the source on `main`. It passes CI because it is still valid TypeScript.

# SECOND BUG (same block)
~678 open tasks system-wide; old logic `.limit(500)`, no ordering, one `.in()` of up to 500 UUIDs (~18 KB URL). Fix must: deterministic ordering, paginate open tasks, chunk the completed-job lookup, keep reconciliation semantics, no unbounded query, no arbitrary bigger limit.

# PATCH
`work-engine-fix.patch` is attached (dry-run applies cleanly to current `main`). Review, apply, adjust only if inspection shows a real need. Result must contain REAL line breaks.

# PHASE 1 — FIX + LOCAL CHECKS
1. Inspect `work-engine.ts`, apply/review patch.
2. Confirm: no literal `\n` in executable code; `completedJobs` declared before use; open-task query is code not comment; pagination/chunking present.
3. Grep the WHOLE `supabase/functions` tree for the same corruption (e.g. `grep -rn '\\n  //\|\\n  const\|\\n  await' supabase/functions`). The same AI-written commit may have broken other files. Fix any real hits the same way.
4. `deno check` founder-brain-tick, founder-objective, ai-engine (+ any repo lint/tests). Inspect final diff.

# PHASE 2 — COMMIT + DEPLOY
Commit, push to `main`, wait for GitHub Actions, confirm success. Verify new versions: founder-brain-tick > v39, founder-objective > v20. No one-off direct deploys.

# PHASE 3 — VERIFY RUNTIME
`completedJobs is not defined` must disappear. Tick response `objectiveLoop` must be non-empty and include `6217332e`. No new errors from work-engine / founder-brain-tick / founder-objective.

# PHASE 4 — LET THE OBJECTIVE RECOVER
Wait for cron `fkaios-founder-brain-tick` (every 15 min) or invoke it via its normal authenticated endpoint. Expected path: completed AI job → Task 1 `done` (via returnCompletedWork) → Task 2 out of `rework` → allocated → new ai_job → done → verification → project `completed` + `final_output` → request `completed` + `result_summary`.
Never write statuses manually.

# PHASE 5 — EVIDENCE
Only ~1 row in `brain_knowledge_chunks` mentions GoMax (0 in knowledge_documents / knowledge_articles / documents). Task 1's knowledge.search ran with `brand_id: null`.
Let the fixed pipeline run first. If verification fails for lack of evidence:
- ingest ONLY real GoMax material available in the repo/project via `document-ingest`;
- then use the existing `founder-objective` `rerun` action on the SAME objective `6217332e…` (it creates a continuation pass; it is not a new objective);
- if no real source material exists, stop and report exactly what evidence is missing. Do not invent documents, numbers or URLs.

# REQUIRED OUTPUT (if evidence suffices)
Current GoMax sales situation · exactly 3 evidence-backed risks · exactly 3 actions mapped to risks · P1/P2/P3 execution plan · sources/evidence chain attached.

# FINAL VERIFICATION — DO NOT STOP EARLY
CODE fixed + checks pass → DEPLOY on main, CI green, new versions live → RUNTIME error gone, loop runs → OBJECTIVE Task 1 reconciled, Task 2 executed, verification ran → RESULT populated → CONSOLE shows real COMPLETED state.
Also report (do not fix): count of the ~678 open orchestration_tasks by status/age.

# ABSOLUTE RULES
No new objective · no manual completion · no bypassed or weakened verification · no fabricated evidence · no unrelated rewrites · don't stop at green CI, at deploy, or at Task 1 moving. Continue to the legitimate terminal state, or to a clearly identified real-evidence blocker.

## work-engine-fix.patch

```diff
--- a/supabase/functions/_shared/work-engine.ts
+++ b/supabase/functions/_shared/work-engine.ts
@@ -267,7 +267,37 @@
 // explicit ask.
 export async function returnCompletedWork(): Promise<{ returned: number; dispatched: number }> {
   const client = getClient();
-  // Only inspect completed jobs whose linked orchestration task is still open.\n  // The old global .limit(20) could be consumed by unrelated historical jobs,\n  // leaving a newly completed objective task at "assigned" with no live job.\n  // The objective loop then correctly (but wrongly for this case) re-opened it\n  // as "rework". Resolve the open-task set first so completion return is\n  // deterministic and independent of queue history.\n  const { data: openTasks } = await client\n    .from("orchestration_tasks")\n    .select("id, status")\n    .in("status", ["pending", "assigned", "running", "working", "rework"])\n    .limit(500);\n  const openTaskIds = (openTasks ?? []).map((t) => String(t.id)).filter(Boolean);\n  if (openTaskIds.length === 0) return { returned: 0, dispatched: 0 };\n\n  const { data: completedJobs } = await client\n    .from("ai_jobs")\n    .select("id, payload, result")\n    .eq("status", "completed")\n    .eq("type", "work_engine_task")\n    .in("payload->>task_id", openTaskIds);
+  // Only inspect completed jobs whose linked orchestration task is still open.
+  // The old global .limit(20) could be consumed by unrelated historical jobs,
+  // leaving a newly completed objective task at "assigned" with no live job.
+  // Resolve the FULL open-task set (paginated, newest first) and look up
+  // completed jobs in chunks, so neither a row cap nor URL length can hide a
+  // newly finished objective task.
+  const openTaskIds: string[] = [];
+  for (let from = 0; ; from += 1000) {
+    const { data: page, error: pageErr } = await client
+      .from("orchestration_tasks")
+      .select("id")
+      .in("status", ["pending", "assigned", "running", "working", "rework"])
+      .order("created_at", { ascending: false })
+      .range(from, from + 999);
+    if (pageErr) throw new Error(`returnCompletedWork: open task load failed: ${pageErr.message}`);
+    for (const t of page ?? []) if (t?.id) openTaskIds.push(String(t.id));
+    if (!page || page.length < 1000) break;
+  }
+  if (openTaskIds.length === 0) return { returned: 0, dispatched: 0 };
+
+  const completedJobs: Array<{ id: string; payload: unknown; result: unknown }> = [];
+  for (let k = 0; k < openTaskIds.length; k += 100) {
+    const { data: chunk, error: jobErr } = await client
+      .from("ai_jobs")
+      .select("id, payload, result")
+      .eq("status", "completed")
+      .eq("type", "work_engine_task")
+      .in("payload->>task_id", openTaskIds.slice(k, k + 100));
+    if (jobErr) throw new Error(`returnCompletedWork: completed job load failed: ${jobErr.message}`);
+    completedJobs.push(...((chunk ?? []) as typeof completedJobs));
+  }
   if (!completedJobs || completedJobs.length === 0) return { returned: 0, dispatched: 0 };
 
   let returned = 0;
```
