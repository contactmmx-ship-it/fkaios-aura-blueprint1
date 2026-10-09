// BLUEPRINT REUSE — build a new deliverable from a proven one without copying
// what does not belong to the new brand.
//
//   1. Load the actual source artifact (a stored proposal or an ingested
//      document) and the target brand's recorded facts (brands table).
//   2. ANALYSE (routed, schema-bound): split the source into sections, each
//      with its reusable method and its brand-specific facts.
//   3. ADAPT (routed, schema-bound): write the new deliverable section by
//      section, using only the target's recorded facts; anything the target
//      has not recorded is written as [TO VERIFY: …], never invented.
//   4. VERIFY (deterministic, not the writing model): no source brand or
//      counterparty name leaks; the target brand appears; every source section
//      is carried over; recorded target facts are used; every figure in the
//      output is either a recorded target fact or marked [TO VERIFY].
//   5. Record the result with its link to the original (knowledge library +
//      evidence), so the lineage and the lessons are kept.

import { routedStructuredCall } from "./structured-reasoning.ts";
import { ingestText } from "./knowledge-library.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type SourceRef = { kind: "client_project"; id: string } | { kind: "knowledge_source"; id: string };

export interface SourceArtifact { ref: string; title: string; text: string; brand: string | null; counterparty: string | null }
export interface TargetBrand { name: string; sector: string | null; type: string | null; investment_range: string | null; royalty: string | null; description: string | null }

export async function loadSource(db: Db, ref: SourceRef): Promise<SourceArtifact> {
  const { data: brands } = await db.from("brands").select("name");
  const brandNames = ((brands ?? []) as Array<{ name: string }>).map((b) => b.name);
  if (ref.kind === "client_project") {
    const { data, error } = await db.from("client_projects").select("id,title,scope,client_name").eq("id", ref.id).single();
    if (error || !data) throw new Error(`source client_projects:${ref.id} not found`);
    const text = `${data.title}\n\n${data.scope ?? ""}`;
    return { ref: `client_projects:${data.id}`, title: data.title, text, brand: brandNames.find((b) => text.includes(b)) ?? null, counterparty: data.client_name ?? null };
  }
  const { data: src, error } = await db.from("fkaios_knowledge_sources").select("id,title,brand").eq("id", ref.id).single();
  if (error || !src) throw new Error(`source fkaios_knowledge_sources:${ref.id} not found`);
  const { data: pages } = await db.from("fkaios_knowledge_pages").select("pdf_page,text").eq("source_id", ref.id).order("pdf_page");
  const text = ((pages ?? []) as Array<{ text: string }>).map((p) => p.text).join("\n\n");
  return { ref: `fkaios_knowledge_sources:${src.id}`, title: src.title, text, brand: src.brand ?? brandNames.find((b) => text.includes(b)) ?? null, counterparty: null };
}

export async function loadTarget(db: Db, brandName: string): Promise<TargetBrand> {
  const { data, error } = await db.from("brands").select("name,sector,type,investment_range,royalty,description").ilike("name", brandName).maybeSingle();
  if (error || !data) throw new Error(`target brand "${brandName}" is not recorded in brands`);
  return data as TargetBrand;
}

const ANALYSE = {
  name: "emit_analysis", description: "The ONLY way to answer.",
  input_schema: {
    type: "object",
    properties: {
      sections: {
        type: "array", minItems: 1,
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            reusable_method: { type: "string", description: "What this section does that works for any brand" },
            brand_specific_facts: { type: "array", items: { type: "string" }, description: "Names, places, figures and claims that belong only to the source brand or counterparty" },
          },
          required: ["heading", "reusable_method", "brand_specific_facts"],
        },
      },
    },
    required: ["sections"],
  },
};

const ADAPT = {
  name: "emit_deliverable", description: "The ONLY way to answer.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      sections: {
        type: "array", minItems: 1,
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            inherited_from: { type: "string", description: "Heading of the source section this one is built from" },
            text: { type: "string" },
            changed: { type: "array", items: { type: "string" }, description: "What was replaced or removed relative to the source" },
          },
          required: ["heading", "inherited_from", "text", "changed"],
        },
      },
      unverified: { type: "array", items: { type: "string" }, description: "Every claim that needs confirmation before use" },
    },
    required: ["title", "sections", "unverified"],
  },
};

export interface AdaptedSection { heading: string; inherited_from: string; text: string; changed: string[] }
export interface ReuseChecks { [name: string]: { ok: boolean; detail?: unknown } }

/** Figures (digit groups) in the text that are neither recorded target facts nor inside a [TO VERIFY …] marker. */
export function unsupportedFigures(text: string, allowed: string[]): string[] {
  const stripped = text.replace(/\[TO VERIFY[^\]]*\]/gi, " ");
  const allowedDigits = new Set(allowed.flatMap((a) => a.match(/\d+(?:\.\d+)?/g) ?? []));
  const found = stripped.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return [...new Set(found.filter((n) => {
    const clean = n.replace(",", "");
    if (allowedDigits.has(clean)) return false;
    return Number(clean) > 12; // list numbering and small counts (1-12) are structure, not claims
  }))];
}

export function verifyAdaptation(source: SourceArtifact, sourceSections: string[], target: TargetBrand, adapted: { title: string; sections: AdaptedSection[] }): ReuseChecks {
  const all = [adapted.title, ...adapted.sections.map((s) => `${s.heading}\n${s.text}`)].join("\n");
  const lower = all.toLowerCase();
  const leaked = [source.brand, source.counterparty].filter((n): n is string => !!n && n.toLowerCase() !== target.name.toLowerCase()).filter((n) => lower.includes(n.toLowerCase()));
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const inherited = new Set(adapted.sections.map((s) => norm(s.inherited_from)));
  const missing = sourceSections.filter((h) => !inherited.has(norm(h)));
  const facts = [target.investment_range, target.royalty].filter((f): f is string => !!f);
  const factsUsed = facts.filter((f) => all.includes(f));
  const unsupported = unsupportedFigures(all, facts);
  return {
    no_source_names: { ok: leaked.length === 0, detail: leaked },
    target_named: { ok: lower.includes(target.name.toLowerCase()) },
    sections_carried_over: { ok: missing.length === 0, detail: { source: sourceSections.length, missing } },
    recorded_facts_used: { ok: factsUsed.length === facts.length, detail: { facts, used: factsUsed } },
    no_unsupported_figures: { ok: unsupported.length === 0, detail: unsupported },
  };
}

export const MAX_CORRECTION_ROUNDS = 2;

export interface ReuseResult { rounds: Array<{ round: number; failed: string[] }>; ok: boolean; source: string; target: string; title: string | null; sections: AdaptedSection[]; unverified: string[]; checks: ReuseChecks; resources: string[]; evidence: string | null; stored: string | null; failure: string | null }

export async function reuseBlueprint(db: Db, input: { source: SourceRef; targetBrand: string; store?: boolean; requestedBy?: string }): Promise<ReuseResult> {
  const source = await loadSource(db, input.source);
  const target = await loadTarget(db, input.targetBrand);
  const resources: string[] = [];
  const fail = (failure: string): ReuseResult => ({ rounds: [], ok: false, source: source.ref, target: target.name, title: null, sections: [], unverified: [], checks: {}, resources, evidence: null, stored: null, failure });

  const analysis = await routedStructuredCall(db, {
    engine: "blueprint-reuse", taskClass: "reasoning", toolSchema: ANALYSE, maxTokens: 3000,
    system: "You analyse a proven business deliverable so it can be reused for another brand. Split it into its sections in order. For each, state the reusable method and list every fact that belongs only to the source brand or the source counterparty (names, places, figures, claims). Do not summarise away sections.",
    user: `SOURCE (${source.ref}):\n${source.text.slice(0, 12000)}`,
  });
  if (!analysis.ok || !Array.isArray(analysis.input?.sections)) return fail(`analysis: ${analysis.failure}`);
  if (analysis.resourceRef) resources.push(analysis.resourceRef);
  const sections = analysis.input!.sections as Array<{ heading: string; reusable_method: string; brand_specific_facts: string[] }>;

  const facts = [`Brand: ${target.name}`, target.sector && `Sector: ${target.sector}`, target.type && `Model: ${target.type}`, target.investment_range && `Investment range: ${target.investment_range}`, target.royalty && `Royalty: ${target.royalty}`, target.description && `Description: ${target.description}`].filter(Boolean).join("\n");
  const system = [
    "You build a new deliverable for the TARGET brand from a proven SOURCE deliverable.",
    "Keep every source section, in order, and its method; set inherited_from to the source section heading exactly.",
    "Replace every source-specific fact. Never mention the source brand or the source counterparty.",
    "Use ONLY the target facts given. Any name, place, figure, date or claim the target facts do not contain must be written as [TO VERIFY: what is needed] and also listed in unverified.",
    "Where the source addressed a named counterparty, address [PROSPECT] instead.",
  ].join("\n");
  const baseUser = `TARGET FACTS (recorded by the founder):\n${facts}\n\nSOURCE SECTIONS:\n${JSON.stringify(sections, null, 1).slice(0, 8000)}\n\nSOURCE TEXT:\n${source.text.slice(0, 10000)}`;

  // Write, verify by code, and route each failed check back as a correction —
  // never declare success until every check passes (bounded rounds).
  let adapted = { title: "", sections: [] as AdaptedSection[] };
  let unverified: string[] = [];
  let checks: ReuseChecks = {};
  const rounds: Array<{ round: number; failed: string[] }> = [];
  for (let round = 0; round <= MAX_CORRECTION_ROUNDS; round++) {
    const failedNow = Object.entries(checks).filter(([, c]) => !c.ok);
    const correction = round === 0 ? "" : `\n\nYOUR PREVIOUS DRAFT FAILED THESE CHECKS — fix exactly these and keep everything else:\n${failedNow.map(([k, c]) => `- ${k}: ${JSON.stringify(c.detail ?? "failed")}`).join("\n")}\n(For figures: replace each listed number with [TO VERIFY: …] unless it is a recorded target fact.)\n\nPREVIOUS DRAFT:\n${JSON.stringify(adapted).slice(0, 9000)}`;
    const adapt = await routedStructuredCall(db, { engine: "blueprint-reuse", taskClass: "writing", toolSchema: ADAPT, maxTokens: 5000, system, user: baseUser + correction });
    if (!adapt.ok || !Array.isArray(adapt.input?.sections)) return fail(`adaptation (round ${round}): ${adapt.failure}`);
    if (adapt.resourceRef) resources.push(adapt.resourceRef);
    adapted = { title: String(adapt.input!.title ?? ""), sections: adapt.input!.sections as AdaptedSection[] };
    unverified = Array.isArray(adapt.input!.unverified) ? (adapt.input!.unverified as unknown[]).map(String) : [];
    checks = verifyAdaptation(source, sections.map((s) => s.heading), target, adapted);
    const failed = Object.entries(checks).filter(([, c]) => !c.ok).map(([k]) => k);
    rounds.push({ round, failed });
    if (failed.length === 0) break;
  }
  const ok = Object.values(checks).every((c) => c.ok);
  const { data: ev } = await db.from("fkaios_verification_evidence").insert({
    requirement_key: "knowledge:blueprint_reuse", evidence_type: "deterministic_check", verifier: "deterministic:blueprint_reuse_checks", status: ok ? "passed" : "failed",
    observed_result: { source: source.ref, target: target.name, checks, rounds, resources, sections: adapted.sections.map((s) => ({ heading: s.heading, inherited_from: s.inherited_from, changed: s.changed })), unverified },
    verification_notes: `${source.ref} → ${target.name}: ${Object.entries(checks).map(([k, v]) => `${k}=${v.ok ? "ok" : "FAIL"}`).join(", ")}`,
    verified_at: new Date().toISOString(),
  }).select("id").single();

  let stored: string | null = null;
  if (ok && input.store) {
    const doc = `# ${adapted.title}\n\nDerived from ${source.ref} ("${source.title}") for ${target.name}. Checks: ${Object.keys(checks).join(", ")} passed (evidence ${ev?.id ?? "n/a"}).\n\n` +
      adapted.sections.map((s) => `## ${s.heading}\n\n${s.text}\n\n_Built from: ${s.inherited_from}. Changed: ${s.changed.join("; ") || "nothing"}._`).join("\n\n") +
      `\n\n## Items to verify before use\n\n${unverified.map((u) => `- ${u}`).join("\n") || "- none"}\n`;
    const r = await ingestText(db, doc, { title: adapted.title, sourceKind: "proposal", brand: target.name, projectRef: target.name, copyrightClass: "owned", provenance: `derived from ${source.ref} by blueprint reuse; evidence ${ev?.id ?? "n/a"}; requested by ${input.requestedBy ?? "FKAIOS"}` });
    stored = r.sourceId;
  }
  return { rounds, ok, source: source.ref, target: target.name, title: adapted.title, sections: adapted.sections, unverified, checks, resources, evidence: ev?.id ?? null, stored, failure: ok ? null : "one or more deterministic checks failed" };
}
