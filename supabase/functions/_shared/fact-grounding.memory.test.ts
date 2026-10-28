// ONE BRAIN (28 Oct 2026): founder-memory evidence from knowledge.search can ground a synthesis report.
import { assessTaskEvidence, compactDispatchForStorage, founderMemoryUrl, researchedSourceUrls } from "./fact-grounding.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

const MEM = "11111111-2222-3333-4444-555555555555";
const searchTask = (similarity: number) => ({
  id: "t1", status: "done", title: "Examine FKAIOS Memory for Chaat Masters Artifacts", description: "Search our past work",
  output: JSON.stringify({ llmResult: {}, companyOsDispatch: compactDispatchForStorage({
    capability: "knowledge.search", status: "success", attempts: 1,
    data: { query: "Chaat Masters franchise model", matches: [
      { id: null, chunk_id: null, document_id: MEM, similarity, chunk_text: "[ChatGPT: Chaat Masters Franchise Model] ...", source: "founder_memory" },
      { id: "chunk-1", document_id: "vault-doc", similarity: 0.9, chunk_text: "vault text" },
    ] },
  }) }),
});
const report = (url: string) => ({
  id: "t2", status: "done", title: "Compile and verify the final report", description: "Compile the brief with franchise sales figures",
  output: JSON.stringify({ report: "brief", sources: [{ title: "Chaat Masters Franchise Model", url }] }),
});

Deno.test("memory match at/above 0.8 becomes a fetched source; vault chunks do not", () => {
  const urls = researchedSourceUrls([searchTask(0.875)]);
  assert(urls.has(founderMemoryUrl(MEM)), "memory url counted");
  assert(urls.size === 1, "vault chunk has no citable url");
});

Deno.test("memory match below 0.8 is not a source", () => {
  assert(researchedSourceUrls([searchTask(0.75)]).size === 0, "weak match ignored");
});

Deno.test("report citing a returned memory chat is verified", () => {
  const tasks = [searchTask(0.875), report(founderMemoryUrl(MEM))];
  const v = assessTaskEvidence(tasks[1], researchedSourceUrls(tasks));
  assert(v.verdict === "verified", `expected verified, got ${v.verdict}: ${v.reason}`);
});

Deno.test("report citing a memory chat that search never returned stays ungrounded", () => {
  const tasks = [searchTask(0.875), report(founderMemoryUrl("99999999-0000-0000-0000-000000000000"))];
  const v = assessTaskEvidence(tasks[1], researchedSourceUrls(tasks));
  assert(v.verdict !== "verified", "invented memory url must not verify");
});

import { checkWorkerGrounding, summarizePriorEvidence } from "./fact-grounding.ts";

Deno.test("summarizePriorEvidence lists founder-memory sources from a knowledge.search task", () => {
  const prior = [{ title: "Examine memory", status: "done", output: searchTask(0.875).output }];
  const sum = summarizePriorEvidence(prior);
  assert(sum.verified && sum.sources.some((s) => s.url === founderMemoryUrl(MEM)), "memory source summarized");
});

Deno.test("worker grounding accepts a report citing only summarized memory sources", () => {
  const prior = summarizePriorEvidence([{ title: "Examine memory", status: "done", output: searchTask(0.875).output }]);
  const result = { report: "brief", sources: [{ title: "Chaat Masters Franchise Model", url: founderMemoryUrl(MEM) }], prior_evidence: prior };
  const g = checkWorkerGrounding({ title: "Compile the brief", description: "franchise sales figures" }, result);
  assert(g.ok, "grounded by memory");
});
