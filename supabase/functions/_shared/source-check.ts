// Deterministic source check for objective deliverables (3 Nov 2026).
//
// Why: an objective deliverable passed the independent (LLM) verifier although
// it credited figures to a founder-memory document that does not contain them,
// invented a team split, and used another brand's chat as a source. The LLM
// verifier judges wording; this check judges facts, mechanically:
//   1. FIGURE IN SOURCE — on every line that names a source ("Source: …"), each
//      money / percentage / count figure must appear in the text of at least one
//      named source. A founder-stated figure must not be credited to a source
//      that does not contain it. Lines labelled "Assumption" are not checked
//      here (the figures contract requires their formula instead).
//   2. SOURCE WAS RETRIEVED — a named source must be one this objective's
//      knowledge.search actually returned (only enforced when the objective
//      used founder memory and no web research).
//   3. RIGHT BRAND — when the objective names a brand, a cited source that
//      mentions another known brand but not the target brand is flagged (a
//      source naming no brand at all, e.g. a scheme brochure chat, is allowed).
// Pure: no imports, so it is unit-tested offline. The caller loads source texts.

export interface CheckedSource { id: string; title: string; text: string }

export interface SourceCheckInput {
  deliverable: string;
  objectiveText: string;
  /** Founder-memory sources this objective retrieved (title + full text). */
  sources: CheckedSource[];
  /** Brand names the objective is about (already filtered to brands named in the objective). */
  targetBrands: string[];
  /** The other known brands (not the target, not the umbrella company). */
  otherBrands?: string[];
  /** True when web research sources were also retrieved: unmatched source names are then not flagged. */
  hasWebSources?: boolean;
}

export interface SourceCheckResult { checkedLines: number; checkedFigures: number; issues: string[] }

const MAX_ISSUES = 15;

function norm(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const GENERIC_BRAND_WORDS = new Set(["franchise", "kids", "mr", "the", "turning", "point", "paints", "paint", "masters", "lab", "labs", "bake", "and"]);
/** Whole-word aliases of a brand name: the full name and its distinctive first word ("gio" for "Gio Paints"). */
export function brandAliases(name: string): string[] {
  const full = norm(name);
  if (full.length < 3) return [];
  const words = full.split(" ").filter((w) => w.length >= 3 && !GENERIC_BRAND_WORDS.has(w));
  return [...new Set([full, ...(words.length ? [words[0]] : [])])];
}

export interface Figure { raw: string; values: number[]; pct: boolean }

const UNIT: Record<string, number> = { lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, l: 1e5, crore: 1e7, crores: 1e7, cr: 1e7, k: 1e3 };
const FIGURE_RE = /(₹|rs\.?\s*|inr\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(?:–|-|to)\s*(\d[\d,]*(?:\.\d+)?))?\s*(lakhs?|lacs?|crores?|cr\b|l\b|k\b|%)?/gi;

/** Money, percentage and count figures in a piece of text, as numeric values. */
export function extractFigures(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE_RE)) {
    const [raw, currency, a, b, unitRaw] = m;
    const unit = (unitRaw ?? "").toLowerCase();
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 8), start).toLowerCase();
    const after = text.slice(start + raw.length, start + raw.length + 8).toLowerCase();
    if (/[a-z]$/.test(before) && !currency) continue; // P08, v1, Q3, FY26 …
    if (/^\s*(st|nd|rd|th)\b/.test(after)) continue;
    const pct = unit === "%";
    const mult = UNIT[unit] ?? 1;
    const nums = [a, b].filter((x): x is string => typeof x === "string").map((x) => Number(x.replace(/,/g, "")));
    if (nums.some((n) => !Number.isFinite(n))) continue;
    const significant = Boolean(currency) || pct || mult !== 1 || nums.some((n) => n >= 10);
    if (!significant) continue;
    if (!currency && !pct && mult === 1) {
      // dates, years, durations and ordinals are not business figures
      if (nums.every((n) => n >= 1900 && n <= 2100)) continue;
      if (/^\s*-?\s*(days?|weeks?|months?|years?|hours?|hrs?|mins?|minutes?|am|pm|kg)\b/.test(after)) continue; // "90 days", "90-day"
      if (/(day|month|week|phase|step|round|top|p\.)\s*$/.test(before)) continue;
      if (/^[-/.]\d/.test(after) || /\d[-/.]$/.test(before)) continue; // 2026-10-02, 10/5
    }
    out.push({ raw: raw.trim(), values: nums.map((n) => n * mult), pct });
  }
  return out;
}

function figureIn(fig: Figure, pool: Figure[]): boolean {
  return fig.values.every((v) => pool.some((p) => p.pct === fig.pct && p.values.some((pv) => Math.abs(pv - v) <= Math.max(0.005 * Math.abs(v), 1e-9))));
}

/** Source names written after "source:" on a line, split on ";" and ",". */
export function attributedNames(line: string): string[] {
  const names: string[] = [];
  for (const m of line.matchAll(/sources?\s*:\s*([^)\]\n]+)/gi)) {
    for (const part of m[1].split(/;|,(?![^(]*\))/)) {
      const name = part.replace(/\*+/g, "").trim();
      if (name.length >= 4) names.push(name);
    }
  }
  return names;
}

/** The retrieved source a written name refers to, by title prefix/containment. */
export function matchSource(name: string, sources: CheckedSource[]): CheckedSource | null {
  const n = norm(name.replace(/\(\d{4}-\d{2}-\d{2}\)/g, ""));
  if (n.length < 4) return null;
  let best: CheckedSource | null = null;
  let bestLen = 0;
  for (const s of sources) {
    const t = norm(s.title);
    if (t.startsWith(n) || n.startsWith(t) || (n.length >= 12 && t.includes(n))) {
      const len = Math.min(n.length, t.length);
      if (len > bestLen) { best = s; bestLen = len; }
    }
  }
  return best;
}

export function checkDeliverableSources(input: SourceCheckInput): SourceCheckResult {
  const issues: string[] = [];
  const add = (msg: string) => { if (issues.length < MAX_ISSUES && !issues.includes(msg)) issues.push(msg); };
  const objectiveFigures = extractFigures(input.objectiveText);
  const sourceFigures = new Map<string, Figure[]>();
  const figuresOf = (s: CheckedSource) => {
    let f = sourceFigures.get(s.id);
    if (!f) { f = extractFigures(`${s.title}\n${s.text}`); sourceFigures.set(s.id, f); }
    return f;
  };
  const brands = input.targetBrands.flatMap(brandAliases);
  const others = (input.otherBrands ?? []).map((b) => ({ name: b, aliases: brandAliases(b) })).filter((b) => b.aliases.length > 0);
  const brandChecked = new Set<string>();
  let checkedLines = 0;
  let checkedFigures = 0;

  for (const rawLine of input.deliverable.split(/\n+/)) {
    const line = rawLine.trim();
    const names = attributedNames(line);
    if (names.length === 0) continue;
    const matched: CheckedSource[] = [];
    for (const name of names) {
      const src = matchSource(name, input.sources);
      if (src) { matched.push(src); continue; }
      if (!input.hasWebSources && input.sources.length > 0) add(`Cites "${name.slice(0, 80)}", which this objective never retrieved from founder memory.`);
    }
    for (const src of matched) {
      if (!brands.length || brandChecked.has(src.id)) continue;
      brandChecked.add(src.id);
      const hay = ` ${norm(`${src.title} ${src.text}`)} `;
      if (brands.some((b) => hay.includes(` ${b} `))) continue;
      const foreign = others.find((o) => o.aliases.some((a) => hay.includes(` ${a} `)));
      if (foreign) add(`Source "${src.title.slice(0, 80)}" is about ${foreign.name}, not ${input.targetBrands.join(" / ")}; it cannot support this plan.`);
    }
    if (/assumption/i.test(line) || matched.length === 0) continue;
    checkedLines++;
    // Figures are checked on the text before the first "source:" so the source's own name/date is not a claim.
    const claim = line.split(/\(?\s*sources?\s*:/i)[0];
    const pool = matched.flatMap(figuresOf);
    const founderStated = /founder[- ]stated/i.test(line);
    for (const fig of extractFigures(claim)) {
      checkedFigures++;
      if (figureIn(fig, pool)) continue;
      const titles = [...new Set(matched.map((s) => `"${s.title.slice(0, 60)}"`))].join(", ");
      if (founderStated && figureIn(fig, objectiveFigures)) add(`"${fig.raw}" is founder-stated but credited to ${titles}, which does not contain it. Label it founder-stated only.`);
      else add(`"${fig.raw}" is credited to ${titles}, but that source does not contain this figure.`);
    }
  }
  return { checkedLines, checkedFigures, issues };
}
