// AI WORLD DIGEST — outer-world knowledge for the one brain.
//
// The brain knows two kinds of things: Rajeev's brands and work (project_ref
// P00-P63 in the knowledge library) and the AI world outside (project_ref W01,
// brand "AI World"). Every scheduled World Radar run writes ONE dated library
// source, "AI World Radar: <date>", holding:
//   - new finds that match a real project need (from ecosystem discovery), and
//   - the newest AI research papers (arXiv cs.AI / cs.LG / cs.CL) that match
//     the founder's research interests, each tagged with the research
//     direction and the project it could help. (Hugging Face's daily-papers
//     API returned 404 on 29 Oct 2026; arXiv's public API answers.)
// The brain's search (vault-engine -> fkaios_memory_search) reads the library,
// so a new model, tool or paper becomes something the brain can recall when an
// objective needs it, the day it appears. Nothing here installs or runs a find.
// Paper titles and abstracts are untrusted text: clipped, never interpreted.

import { clip, PROJECT_NEEDS } from "./ecosystem-discovery.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const WORLD_PROJECT_REF = "W01";
export const WORLD_BRAND = "AI World";
export const PAPERS_PER_DAY = 8;
const PAGE_CHARS = 3000;

/** Research directions the founder follows (how AI learns, thinks and acts like a human brain). */
export const RESEARCH_INTERESTS: Array<{ key: string; term: RegExp }> = [
  { key: "learning from experience (reinforcement learning)", term: /\b(reinforcement learning|rl\b|reward|self-play|experience)/i },
  { key: "world models and prediction", term: /\b(world model|simulat\w*|predict\w* (the )?(future|next state))/i },
  { key: "memory and continual learning", term: /\b(memory|continual|lifelong|catastrophic forgetting|long[- ]context)/i },
  { key: "self-improving agents", term: /\b(self[- ]improv\w*|self[- ]evolv\w*|recursive|harness|reflection)/i },
  { key: "computer-use and agents", term: /\b(computer[- ]use|gui agent|web agent|browser|tool[- ]use|agentic|multi-agent)/i },
  { key: "reasoning and planning", term: /\b(reasoning|planning|chain[- ]of[- ]thought|test[- ]time)/i },
  { key: "brain-inspired AI", term: /\b(brain|neuro\w*|cognitive|human-like)/i },
  { key: "speech and Indian languages", term: /\b(speech|asr|tts|hindi|indic|multilingual)/i },
];

export interface Paper { id: string; title: string; summary: string | null; upvotes: number; url: string; relevance?: number }

const xmlText = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** arXiv Atom feed -> papers (regex parsing: the edge runtime has no XML parser; text is clipped and never interpreted). */
export function parseArxivAtom(xml: string): Paper[] {
  const out: Paper[] = [];
  for (const m of String(xml ?? "").matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<id>\s*https?:\/\/arxiv\.org\/abs\/([^<\s]+?)(v\d+)?\s*<\/id>/) ?? [])[1];
    const title = clip(xmlText((e.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? ""), 200);
    if (!id || !title) continue;
    out.push({ id, title, summary: clip(xmlText((e.match(/<summary>([\s\S]*?)<\/summary>/) ?? [])[1] ?? ""), 500), upvotes: 0, url: `https://arxiv.org/abs/${id}` });
  }
  return out;
}

/** Keep the papers that touch the founder's research interests, most directions first. */
export function rankPapersByInterest(papers: Paper[], limit = PAPERS_PER_DAY): Paper[] {
  return papers.map((p) => ({ ...p, relevance: tagPaper(p).directions.length + (tagPaper(p).projects.length ? 1 : 0) }))
    .filter((p) => (p.relevance ?? 0) > 0)
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || b.upvotes - a.upvotes)
    .slice(0, limit);
}

export function tagPaper(p: Paper): { directions: string[]; projects: string[] } {
  const text = `${p.title} ${p.summary ?? ""}`;
  const directions = RESEARCH_INTERESTS.filter((r) => r.term.test(text)).map((r) => r.key);
  const projects = PROJECT_NEEDS.filter((n) => !n.kinds && n.term.test(text)).map((n) => n.projects);
  return { directions, projects };
}

export interface DigestFind { name: string; kind?: string; url?: string | null; score: number; reasons: string[] }

/** Pure: the digest text the brain will read. */
export function buildWorldDigest(date: string, finds: DigestFind[], papers: Paper[]): string {
  const lines: string[] = [
    `# AI World Radar: ${date}`,
    "",
    `Domain: AI WORLD (outer-world knowledge). Written automatically by the FKAIOS World Radar on ${date}.`,
    "Use it when an objective needs a new model, tool, repo or research idea. Finds are metadata only: not installed, not tested yet. Claims are the publishers' own.",
    "",
    `## New tools and models that fit a project need (${finds.length})`,
  ];
  if (!finds.length) lines.push("None today.");
  for (const f of finds) {
    const fit = f.reasons.filter((r) => r.includes(" → ")).map((r) => r.split(" → ")[1]);
    lines.push(`- ${f.name}${f.kind ? ` (${f.kind})` : ""}, score ${f.score}${f.url ? `, ${f.url}` : ""}. Fits: ${fit.join("; ") || "general"}.`);
  }
  lines.push("", `## New research papers in the founder's interest areas (${papers.length}, arXiv cs.AI/cs.LG/cs.CL)`);
  if (!papers.length) lines.push("None fetched today.");
  for (const p of papers) {
    const t = tagPaper(p);
    lines.push(`- ${p.title} (${p.url}).`);
    if (t.directions.length) lines.push(`  Direction: ${t.directions.join("; ")}.`);
    if (t.projects.length) lines.push(`  Could help: ${t.projects.join("; ")}.`);
    if (p.summary) lines.push(`  Crux: ${p.summary}`);
  }
  return lines.join("\n");
}

/** Pure: split text into library pages on line boundaries. */
export function toPages(text: string, max = PAGE_CHARS): Array<{ text: string; line_start: number; line_end: number }> {
  const lines = text.split("\n");
  const pages: Array<{ text: string; line_start: number; line_end: number }> = [];
  let buf: string[] = [];
  let start = 1;
  let size = 0;
  lines.forEach((l, i) => {
    if (buf.length && size + l.length + 1 > max) {
      pages.push({ text: buf.join("\n"), line_start: start, line_end: i });
      buf = []; size = 0; start = i + 1;
    }
    buf.push(l); size += l.length + 1;
  });
  if (buf.length && buf.join("").trim()) pages.push({ text: buf.join("\n"), line_start: start, line_end: lines.length });
  return pages;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ARXIV_QUERY_URL = "https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=100";

export async function fetchDailyPapers(fetcher: Fetcher, _date: string): Promise<Paper[]> {
  const res = await fetcher(ARXIV_QUERY_URL, { headers: { "User-Agent": "fkaios-discovery" } });
  if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
  return rankPapersByInterest(parseArxivAtom(await res.text()));
}

/** Write (or replace) the day's digest as one W01 source in the knowledge library. */
export async function writeWorldDigest(db: Db, date: string, text: string): Promise<{ sourceId: string | null; pages: number; error?: string }> {
  const title = `AI World Radar: ${date}`;
  const pages = toPages(text);
  const sha = await sha256Hex(text);
  const { data: prev } = await db.from("fkaios_knowledge_sources").select("id,sha256").eq("title", title).eq("project_ref", WORLD_PROJECT_REF).maybeSingle();
  if (prev?.sha256 === sha) return { sourceId: prev.id, pages: pages.length };
  let sourceId: string | null = prev?.id ?? null;
  if (sourceId) {
    await db.from("fkaios_knowledge_pages").delete().eq("source_id", sourceId);
    await db.from("fkaios_knowledge_sources").update({ sha256: sha, ingestion_status: "ingesting", updated_at: new Date().toISOString() }).eq("id", sourceId);
  } else {
    const { data: src, error } = await db.from("fkaios_knowledge_sources").insert({
      title, author: "FKAIOS World Radar", source_kind: "document", filename: `ai-world-radar-${date}.md`, storage_bucket: "generated",
      storage_path: `world-radar/${date}`, provenance: "AI World knowledge (W01), written by the daily World Radar run", sha256: sha, mime_type: "text/markdown",
      page_label_basis: "line_ranges", copyright_class: "owned", brand: WORLD_BRAND, project_ref: WORLD_PROJECT_REF, ingestion_status: "ingesting",
      ingestion_report: { domain: "ai_world", generated_by: "world-digest" },
    }).select("id").single();
    if (error || !src) return { sourceId: null, pages: 0, error: error?.message ?? "insert failed" };
    sourceId = src.id;
  }
  const rows = pages.map((p, i) => ({ source_id: sourceId, pdf_page: i + 1, printed_label: `lines ${p.line_start}-${p.line_end}`, label_basis: "line_range",
    line_start: p.line_start, line_end: p.line_end, text: p.text, char_count: p.text.length, extraction: "plain_text", needs_ocr: false, completeness: "complete" }));
  const { error: pageErr } = await db.from("fkaios_knowledge_pages").insert(rows);
  await db.from("fkaios_knowledge_sources").update({ page_count: pageErr ? 0 : rows.length, ingestion_status: pageErr ? "failed" : "complete", updated_at: new Date().toISOString() }).eq("id", sourceId);
  return { sourceId, pages: pageErr ? 0 : rows.length, error: pageErr?.message };
}
