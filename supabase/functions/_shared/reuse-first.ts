// 4 Nov 2026 — REUSE FIRST (founder's standing rule): before any objective is planned, look in this order:
//   1. FKAIOS's own past work (founder memory) — for ANY brand. Same-brand hits may supply DATA; other-brand
//      hits may only supply METHOD (structure, approach), never their figures.
//   2. Tools the World Radar already found (fkaios_ecosystem_candidates) and GitHub repositories.
//   3. Free AI tools/capabilities already registered.
// Before this, the GitHub step pasted the raw objective ("objective gomax growth plan reach 50 lakh …") into
// GitHub search and found nothing (run 6: 0 candidates), and memory and the Radar were never consulted.
// This file is pure (no I/O) so every rule is unit-tested.

const STOP = new Set(("a an and are as at be by for from has have in into is it its of on or that the this to was were will with " +
  "objective objectives use using only founder memory register information deliver deliverable include including each every " +
  "within days day month months monthly weekly daily plus approx approximate approximately current position checked against " +
  "records your yours mine must should would could write rules cite source sources number numbers figure figures never invent " +
  "unknown instead keep specific generic make create build need needs want please reach target targets which what who whom how " +
  "their them they these those other than then also than more most less lakh lakhs crore crores rupees rs inr per cent percent " +
  "files file chats chat p08 p01 based give provide list tell show").split(/\s+/));

export interface MemoryHit { source_id: string; title: string; brand: string | null; score: number }
export interface MemoryReuse extends MemoryHit { use: "data_and_method" | "method_only" | "check_brand" }
export interface RadarCandidate { name: string; url: string | null; kind: string | null; license: string | null; description: string | null }

/** Content words of the objective, in order of first appearance, without brand names, numbers or filler. */
export function searchTerms(objective: string, brandNames: string[] = [], max = 6): string[] {
  const brandWords = new Set(brandNames.flatMap((b) => b.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3));
  const words = objective.toLowerCase()
    .replace(/₹\s?[0-9.,]+/g, " ")
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !brandWords.has(w));
  const out: string[] = [];
  for (const w of words) {
    const singular = w.endsWith("s") ? w.slice(0, -1) : w;
    if (out.includes(w) || out.includes(singular) || out.includes(w + "s")) continue;
    out.push(w);
  }
  return out.slice(0, max);
}

/** Brands named in the objective (case-insensitive whole-word match). */
export function brandsIn(objective: string, brandNames: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
  const text = ` ${norm(objective)} `;
  return brandNames.filter((b) => {
    const name = norm(b);
    return name.length >= 3 && text.includes(` ${name} `);
  });
}

/** GitHub queries built from content words (never the raw sentence). */
export function githubQueries(terms: string[], objectiveType: string): string[] {
  if (!terms.length) return [];
  const core = terms.slice(0, 3).join(" ");
  const suffix = objectiveType === "information" ? "template" : objectiveType === "product_creation" ? "open source app" : "open source";
  return [...new Set([core, `${terms.slice(0, 2).join(" ")} ${suffix}`])].filter((q) => q.trim().length > 0);
}

/**
 * Past-work hits: same brand → data and method; another brand → method only (never its figures);
 * no brand recorded → check_brand (figures only if the text itself shows they belong to this brand).
 */
export function classifyMemoryHits(hits: MemoryHit[], objectiveBrands: string[]): MemoryReuse[] {
  const own = new Set(objectiveBrands.map((b) => b.toLowerCase()));
  return hits.map((h) => ({
    ...h,
    use: !h.brand ? "check_brand" : own.has(h.brand.toLowerCase()) ? "data_and_method" : "method_only",
  }));
}

/** Radar candidates ranked by how many search terms their name/description contains. */
export function rankRadar(candidates: RadarCandidate[], terms: string[], max = 10): Array<RadarCandidate & { match: number }> {
  return candidates
    .map((c) => {
      const hay = `${c.name} ${c.description ?? ""}`.toLowerCase();
      return { ...c, match: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((c) => c.match > 0)
    .sort((a, b) => b.match - a.match)
    .slice(0, max);
}

/** One line per source, for the Solution Architect prompt and the contract record. */
export function reuseSummary(memory: MemoryReuse[], radar: Array<{ name: string; match: number }>, github: Array<{ full_name: string }>): string {
  const n = (u: MemoryReuse["use"]) => memory.filter((m) => m.use === u).length;
  return `Reuse-first search: ${memory.length} past-work match(es) (${n("data_and_method")} same brand: data+method; ${n("method_only")} other brands: method only; ${n("check_brand")} brand not recorded: check before using figures), ` +
    `${radar.length} Radar tool(s), ${github.length} GitHub repo(s).`;
}
