import { assertEquals } from "jsr:@std/assert@1";
import { assessObjectiveTasks, assessTaskEvidence, researchedSourceUrls } from "./fact-grounding.ts";
import { recheckGateBlockedObjectives } from "./objective-loop.ts";

// A research task as stored by work-engine: the research.run dispatch with the
// compact excerpt of what the search actually fetched.
const research = (id: string, urls: string[]) => ({
  id, project_id: "p1", status: "done",
  title: "Market & Regulatory Research & Synthesis",
  description: "Research competitors, market size and official regulations.",
  output: JSON.stringify({
    llmResult: { sources: urls.map((url) => ({ url })) },
    companyOsDispatch: {
      capability: "research.run", status: "success",
      data_excerpt: JSON.stringify({ queries: [{ query: "q", results: [{ query: "q", sources: urls.map((url) => ({ url, title: url })) }] }] }),
    },
  }),
});
// The final report as stored on 9 Oct 17:26 UTC: report/sources/prior_evidence
// at the top level, no dispatch of its own.
const report = (id: string, cited: string[], extra: Record<string, unknown> = {}) => ({
  id, project_id: "p1", status: "done",
  title: "Compile and verify the final report",
  description: "Compile the decision-ready report with market figures, competitors and pricing, citing sources.",
  output: JSON.stringify({ report: { executive_summary: "…" }, sources: cited.map((url) => ({ url })), ...extra }),
});

const EMR = "https://www.expertmarketresearch.com/blogs/top-india-pre-school-childcare-franchise";
const PMSHRI = "https://pmshri.education.gov.in/assets/pdf/part1_pmshri.pdf";
const PIB = "https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1780966";

Deno.test("synthesis: Kids DPS final report citing only researched sources is verified", () => {
  const tasks = [research("r1", [EMR, PMSHRI]), research("r2", [PIB]), report("f", [EMR, PMSHRI, PIB])];
  const gate = assessObjectiveTasks(tasks);
  assertEquals(gate.blocked, false);
  assertEquals(gate.allVerified, true);
});

Deno.test("synthesis: one unfetched citation keeps the report ungrounded", () => {
  const gate = assessObjectiveTasks([research("r1", [EMR]), report("f", [EMR, "https://invented.example/stat"])]);
  assertEquals(gate.blocked, true);
});

Deno.test("synthesis: a model-written prior_evidence claim is not evidence", () => {
  const forged = { prior_evidence: { verified: true, source_count: 1, sources: [{ url: "https://invented.example/stat" }] } };
  const v = assessTaskEvidence(report("f", ["https://invented.example/stat"], forged), researchedSourceUrls([]));
  assertEquals(v.verdict, "no_data_source");
  // and without any research in the task set
  assertEquals(assessObjectiveTasks([report("f", [EMR], forged)]).blocked, true);
});

Deno.test("synthesis: a report citing nothing is not verified by research elsewhere", () => {
  assertEquals(assessObjectiveTasks([research("r1", [EMR]), report("f", [])]).blocked, true);
});

Deno.test("synthesis: failed research tasks contribute no sources; trailing slashes normalise", () => {
  const failed = { ...research("r1", [EMR]), status: "rework" };
  assertEquals(researchedSourceUrls([failed]).size, 0);
  assertEquals(researchedSourceUrls([research("r2", [EMR + "/"])]).has(EMR), true);
});

// ── Gate re-check of parked objectives ───────────────────────────────────
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const updates: Array<{ table: string; patch: Row; ids: string[] }> = [];
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
      like: (col: string, pattern: string) => { const prefix = pattern.replace(/%$/, ""); filters.push((r) => String(r[col] ?? "").startsWith(prefix)); return q; },
      in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return q; },
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return q; },
      order: () => q,
      limit: (n: number) => { limit = n; return q; },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return q;
  }
  return { db: { from: query }, updates };
}

const parked = (id: string, summary: string) => ({ id, requested_by: "founder-brain", status: "awaiting_approval", action_taken: "objective_loop", result_summary: summary });

Deno.test("re-check: a gate-blocked objective whose report now verifies resumes processing", async () => {
  const tables = {
    orchestrator_requests: [parked("kids", "BLOCKED: FKAIOS could not complete this objective …")],
    orchestration_projects: [{ id: "p1", status: "working", request: "[objective:kids] Kids DPS" }],
    orchestration_tasks: [research("r1", [EMR, PIB]), report("f", [EMR, PIB])],
  };
  const { db } = fakeDb(tables);
  assertEquals(await recheckGateBlockedObjectives(db), ["kids"]);
  assertEquals(tables.orchestrator_requests[0].status, "processing");
});

Deno.test("re-check: still-ungrounded work and founder decisions stay parked", async () => {
  const tables = {
    orchestrator_requests: [
      parked("still", "BLOCKED: FKAIOS could not complete this objective …"),
      parked("human", "Escalated after 5 replan attempts without convergence — needs human review."),
    ],
    orchestration_projects: [
      { id: "p1", status: "working", request: "[objective:still] x" },
      { id: "p2", status: "working", request: "[objective:human] y" },
    ],
    orchestration_tasks: [research("r1", [EMR]), report("f", ["https://invented.example/stat"]), { ...research("r9", [EMR]), project_id: "p2" }],
  };
  const { db, updates } = fakeDb(tables);
  assertEquals(await recheckGateBlockedObjectives(db), []);
  assertEquals(updates.filter((u) => u.table === "orchestrator_requests").length, 0);
});
