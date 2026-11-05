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

// 5 Nov 2026 — founder rule: a paused (dormant) brand is left out of every plan.
// Its past work is dropped from reuse results unless the objective itself names
// that brand (then the founder has asked for it on purpose).
export function dropPausedBrands(hits: MemoryHit[], pausedBrands: string[], objectiveBrands: string[]): MemoryHit[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const asked = new Set(objectiveBrands.map(norm));
  const paused = pausedBrands.map(norm).filter((b) => b.length >= 3 && !asked.has(b));
  if (!paused.length) return hits;
  return hits.filter((h) => {
    const brand = h.brand ? norm(h.brand) : "";
    const title = ` ${norm(h.title)} `;
    return !paused.some((b) => brand === b || title.includes(` ${b} `));
  });
}


// 5 Nov 2026 — founder's search order for every task (register RU-04, RU-05):
//   1. the founder's OWN repositories (GitHub owner contactmmx-ship-it) — what we already built,
//   2. open-source repositories on public GitHub,
//   3. free AI tools (registered free capabilities and Radar finds),
//   4. previous FKAIOS work in memory,
// and only then build something new.
export const OWN_GITHUB_OWNER = "contactmmx-ship-it";
export const REUSE_ORDER = ["own_repos", "open_source_repos", "free_tools", "previous_work", "build_new"] as const;

/** GitHub queries limited to the founder's own repositories: one per leading term, so any match counts. */
export function ownRepoQueries(terms: string[], owner = OWN_GITHUB_OWNER): string[] {
  if (!owner || !terms.length) return [];
  return [...new Set(terms.slice(0, 3).map((t) => `${t} user:${owner} fork:true`))];
}

/** True for a repository that belongs to the owner (so it is never also listed as an outside repo). */
export function isOwnRepo(fullName: string, owner = OWN_GITHUB_OWNER): boolean {
  return fullName.toLowerCase().startsWith(owner.toLowerCase() + "/");
}

export interface ReuseStep { step: number; source: typeof REUSE_ORDER[number]; found: number; top: string[] }

/** The founder's order, with what each step found, for the planner prompt and the contract record. */
export function reuseOrder(found: { ownRepos: Array<{ full_name: string }>; openSourceRepos: Array<{ full_name: string }>; freeTools: Array<{ name: string }>; previousWork: Array<{ title: string }> }): ReuseStep[] {
  const top = (xs: string[]) => xs.slice(0, 3);
  return [
    { step: 1, source: "own_repos", found: found.ownRepos.length, top: top(found.ownRepos.map((r) => r.full_name)) },
    { step: 2, source: "open_source_repos", found: found.openSourceRepos.length, top: top(found.openSourceRepos.map((r) => r.full_name)) },
    { step: 3, source: "free_tools", found: found.freeTools.length, top: top(found.freeTools.map((t) => t.name)) },
    { step: 4, source: "previous_work", found: found.previousWork.length, top: top(found.previousWork.map((w) => w.title)) },
    { step: 5, source: "build_new", found: 0, top: [] },
  ];
}

/** One line in the founder's order. */
export function reuseOrderLine(steps: ReuseStep[]): string {
  const label: Record<string, string> = { own_repos: "own repos", open_source_repos: "open-source repos", free_tools: "free tools", previous_work: "previous FKAIOS work", build_new: "build new" };
  return "Reuse order: " + steps.filter((s) => s.source !== "build_new").map((s) => `${s.step}) ${label[s.source]}: ${s.found}`).join(", ") + ", 5) build new only for what is left.";
}
