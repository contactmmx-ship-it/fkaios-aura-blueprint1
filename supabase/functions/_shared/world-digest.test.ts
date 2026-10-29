/// <reference lib="deno.ns" />

import { buildWorldDigest, fetchDailyPapers, parseArxivAtom, rankPapersByInterest, tagPaper, toPages, WORLD_PROJECT_REF, writeWorldDigest } from "./world-digest.ts";

// Shape of the live arXiv API answer (export.arxiv.org/api/query, checked 29 Oct 2026).
const ATOM = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2610.00001v1</id>
    <title>Agents that learn from experience
      with reinforcement learning</title>
    <summary>An agent improves through reward from its own experience &amp; memory.</summary>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2610.00002v2</id>
    <title>Hindi speech recognition for clinics</title>
    <summary>ASR for Indic languages in hospital dictation.</summary>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2610.00003v1</id>
    <title>Compact hexagonal primitives for scene rendering</title>
    <summary>A graphics method.</summary>
  </entry>
</feed>`;
const PAPERS = parseArxivAtom(ATOM);

Deno.test("arXiv entries parse with clean ids, titles and summaries", () => {
  if (PAPERS.length !== 3) throw new Error(`expected 3 papers, got ${PAPERS.length}`);
  if (PAPERS[0].id !== "2610.00001" || PAPERS[0].url !== "https://arxiv.org/abs/2610.00001") throw new Error("id/url wrong");
  if (PAPERS[0].title !== "Agents that learn from experience with reinforcement learning") throw new Error("title not normalised");
  if (!PAPERS[0].summary?.includes("& memory")) throw new Error("entities not decoded");
});

Deno.test("only papers in the founder's interest areas are kept", () => {
  const kept = rankPapersByInterest(PAPERS);
  if (kept.length !== 2 || kept.some((p) => p.id === "2610.00003")) throw new Error("graphics paper should be dropped");
});

Deno.test("fetchDailyPapers reads arXiv and fails loudly on HTTP errors", async () => {
  const ok = await fetchDailyPapers(() => Promise.resolve(new Response(ATOM)), "2026-10-30");
  if (ok.length !== 2) throw new Error("expected ranked papers");
  let threw = false;
  try { await fetchDailyPapers(() => Promise.resolve(new Response("no", { status: 503 })), "2026-10-30"); } catch { threw = true; }
  if (!threw) throw new Error("HTTP error must throw so the run records it");
});

Deno.test("papers are tagged with the founder's research directions and the projects they could help", () => {
  const [rl, speech] = PAPERS;
  const t1 = tagPaper(rl);
  if (!t1.directions.some((d) => d.startsWith("learning from experience"))) throw new Error("RL paper must be tagged learning-from-experience");
  const t2 = tagPaper(speech);
  if (!t2.projects.some((x) => x.includes("SYROS"))) throw new Error("speech paper must point at SYROS");
});

Deno.test("digest names the domain, the fit and the crux", () => {
  const text = buildWorldDigest("2026-10-30", [{ name: "baidu/Unlimited-OCR", kind: "model", url: "https://hf.co/x", score: 6, reasons: ["document ocr → eBill2Tally bill scanning", "widely used"] }], PAPERS);
  for (const must of ["# AI World Radar: 2026-10-30", "AI WORLD", "Fits: eBill2Tally bill scanning", "Crux: ASR for Indic", "Direction: learning from experience"]) {
    if (!text.includes(must)) throw new Error(`digest missing: ${must}`);
  }
});

Deno.test("pages split on line boundaries and cover every line", () => {
  const text = Array.from({ length: 300 }, (_, i) => `line ${i + 1} ${"x".repeat(30)}`).join("\n");
  const pages = toPages(text, 1000);
  if (pages.length < 10) throw new Error("expected several pages");
  if (pages[0].line_start !== 1 || pages.at(-1)!.line_end !== 300) throw new Error("lines not covered");
  for (let i = 1; i < pages.length; i++) if (pages[i].line_start !== pages[i - 1].line_end + 1) throw new Error("gap or overlap between pages");
  if (pages.some((p) => p.text.length > 1000)) throw new Error("page over the limit");
});

function fakeDb() {
  const sources: Array<Record<string, unknown>> = [];
  const pages: Array<Record<string, unknown>> = [];
  // deno-lint-ignore no-explicit-any
  const table = (name: string): any => {
    const rows = name === "fkaios_knowledge_sources" ? sources : pages;
    const filters: Array<[string, unknown]> = [];
    const match = (r: Record<string, unknown>) => filters.every(([k, v]) => r[k] === v);
    let pendingInsert: Array<Record<string, unknown>> | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;
    let pendingDelete = false;
    const apply = () => {
      if (pendingUpdate) rows.filter(match).forEach((r) => Object.assign(r, pendingUpdate));
      if (pendingDelete) for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
    };
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      maybeSingle: () => Promise.resolve({ data: rows.find(match) ?? null, error: null }),
      single: () => Promise.resolve({ data: pendingInsert?.[0] ?? null, error: null }),
      insert: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        pendingInsert = (Array.isArray(v) ? v : [v]).map((x) => ({ id: crypto.randomUUID(), ...x }));
        rows.push(...pendingInsert);
        return Object.assign(Promise.resolve({ data: pendingInsert, error: null }), { select: () => q });
      },
      update: (v: Record<string, unknown>) => { pendingUpdate = v; return q; },
      delete: () => { pendingDelete = true; return q; },
      then: (res: (v: unknown) => unknown) => { apply(); return Promise.resolve({ data: null, error: null }).then(res); },
    };
    return q;
  };
  return { sources, pages, from: table };
}

Deno.test("the digest becomes a W01 library source; a rewrite replaces its pages, an identical one is a no-op", async () => {
  const db = fakeDb();
  const a = await writeWorldDigest(db, "2026-10-30", "# AI World Radar: 2026-10-30\nfirst");
  if (!a.sourceId || a.pages !== 1) throw new Error("first write failed");
  const src = db.sources[0];
  if (src.project_ref !== WORLD_PROJECT_REF || src.brand !== "AI World" || src.ingestion_status !== "complete") throw new Error("source not filed as AI World");
  await writeWorldDigest(db, "2026-10-30", "# AI World Radar: 2026-10-30\nsecond");
  if (db.sources.length !== 1) throw new Error("same day must reuse the source");
  if (db.pages.length !== 1 || !String(db.pages[0].text).includes("second")) throw new Error("pages not replaced");
  const before = db.pages.length;
  await writeWorldDigest(db, "2026-10-30", "# AI World Radar: 2026-10-30\nsecond");
  if (db.pages.length !== before) throw new Error("identical digest must not rewrite");
});
