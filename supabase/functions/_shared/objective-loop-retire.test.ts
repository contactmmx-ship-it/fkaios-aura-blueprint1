import { assertEquals } from "jsr:@std/assert@1";
import { retireLivePasses } from "./objective-loop.ts";

// Minimal in-memory stand-in for the three tables retireLivePasses touches.
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const updates: Array<{ table: string; patch: Row; ids: string[] }> = [];
  const field = (row: Row, col: string) => col === "payload->>task_id" ? (row.payload as Row | undefined)?.task_id : row[col];
  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let limit = Infinity;
    const run = () => {
      const rows = tables[table].filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (patch) {
        for (const r of rows) Object.assign(r, patch);
        updates.push({ table, patch, ids: rows.map((r) => String(r.id)) });
      }
      return { data: rows, error: null };
    };
    const q = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      like: (col: string, pattern: string) => { const prefix = pattern.replace(/%$/, ""); filters.push((r) => String(field(r, col)).startsWith(prefix)); return q; },
      in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(field(r, col))); return q; },
      eq: (col: string, val: unknown) => { filters.push((r) => field(r, col) === val); return q; },
      limit: (n: number) => { limit = n; return q; },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return q;
  }
  return { db: { from: query }, updates };
}

const OBJ = "20cbf892-0e6b-4689-9d1f-1a3a4030ce8f";
const project = (id: string, status: string) => ({ id, status, request: `[objective:${OBJ}] Kids DPS` });

Deno.test("retireLivePasses: a founder re-run closes the live plan so a new one can be created", async () => {
  const { db } = fakeDb({
    orchestration_projects: [project("old-failed", "failed"), project("927854fa", "working")],
    orchestration_tasks: [
      { id: "t-done", project_id: "927854fa", status: "done" },
      { id: "t-open", project_id: "927854fa", status: "pending" },
    ],
    ai_jobs: [{ id: "j1", type: "work_engine_task", status: "retry", payload: { task_id: "t-open" } }],
  });
  const res = await retireLivePasses(db, OBJ, "Superseded by the founder's re-run request");
  assertEquals(res, { waiting: false, retired: ["927854fa"] });
});

Deno.test("retireLivePasses: done tasks keep their output; queued jobs fail with the reason", async () => {
  const tables = {
    orchestration_projects: [project("p1", "working")],
    orchestration_tasks: [
      { id: "t-done", project_id: "p1", status: "done", output: "report" },
      { id: "t-open", project_id: "p1", status: "assigned" },
    ],
    ai_jobs: [{ id: "j1", type: "work_engine_task", status: "pending", payload: { task_id: "t-open" } }],
  };
  const { db } = fakeDb(tables);
  await retireLivePasses(db, OBJ, "why");
  assertEquals(tables.orchestration_projects[0].status, "failed");
  assertEquals(tables.orchestration_tasks[0], { id: "t-done", project_id: "p1", status: "done", output: "report" });
  assertEquals(tables.orchestration_tasks[1].status, "rework");
  assertEquals(tables.ai_jobs[0].status, "failed");
  assertEquals(String(tables.ai_jobs[0].error).startsWith("superseded: why"), true);
});

Deno.test("retireLivePasses: a running job is never interrupted; the caller waits", async () => {
  const tables = {
    orchestration_projects: [project("p1", "working")],
    orchestration_tasks: [{ id: "t-open", project_id: "p1", status: "assigned" }],
    ai_jobs: [{ id: "j1", type: "work_engine_task", status: "running", payload: { task_id: "t-open" } }],
  };
  const { db, updates } = fakeDb(tables);
  const res = await retireLivePasses(db, OBJ, "why");
  assertEquals(res, { waiting: true, retired: [] });
  assertEquals(updates.length, 0);
  assertEquals(tables.orchestration_projects[0].status, "working");
});

Deno.test("retireLivePasses: nothing live means nothing changes", async () => {
  const { db, updates } = fakeDb({ orchestration_projects: [project("p0", "complete")], orchestration_tasks: [], ai_jobs: [] });
  assertEquals(await retireLivePasses(db, OBJ, "why"), { waiting: false, retired: [] });
  assertEquals(updates.length, 0);
});
