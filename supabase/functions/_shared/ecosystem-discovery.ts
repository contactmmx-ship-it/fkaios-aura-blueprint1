// ECOSYSTEM DISCOVERY — a daily, scheduled scan of official registries and APIs
// for things FKAIOS could use: MCP servers (official MCP registry), open-source
// repositories (GitHub search), trending open models (Hugging Face) and models
// with a free tier (OpenRouter's public model list).
//
// DISCOVER → FILTER → DEDUPLICATE → ASSESS RELEVANCE → CLASSIFY RISK → RECORD → REPORT.
// Candidates are METADATA ONLY. This pipeline never installs, executes, calls or
// connects anything it finds: executable code, remote services and anything that
// needs credentials stay at status 'new' until they go through the evaluation
// and approval path. Descriptions are untrusted text — stored truncated, never
// interpreted as instructions.
//
// Schedule: once per local day (Asia/Kolkata) after 06:00, from the Founder
// Brain tick (pg_cron, every minute). The unique index on (schedule_date) for
// scheduled runs makes the daily run idempotent; a failed run is retried on a
// later tick, at most MAX_SCHEDULED_ATTEMPTS times a day.

import { buildWorldDigest, fetchDailyPapers, writeWorldDigest, type DigestFind, type Paper } from "./world-digest.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
type Env = (k: string) => string | undefined;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const DISCOVERY_TIMEZONE = "Asia/Kolkata";
export const DISCOVERY_LOCAL_HOUR = 6;
export const MAX_SCHEDULED_ATTEMPTS = 3;
export const HIGH_VALUE_SCORE = 6;
const DESCRIPTION_MAX = 400;

export type CandidateKind = "mcp_server" | "repository" | "model" | "free_model";
export type RiskClass = "metadata_only" | "executable_code" | "remote_service" | "requires_credentials";

export interface Candidate {
  canonicalKey: string;
  source: "mcp_registry" | "github" | "huggingface" | "openrouter";
  kind: CandidateKind;
  name: string;
  url: string | null;
  description: string | null;
  version: string | null;
  license: string | null;
  metrics: Record<string, unknown>;
  riskClass: RiskClass;
}

// What Rajeev's projects need right now, weighted. Relevance is fit to a named
// project need, never keyword hits or popularity: until 29 Oct 2026 a TikTok
// video downloader scored in the same tier as Indian-language OCR because its
// description happened to mention "agent", "MCP" and speech-to-text. Every
// reason now names the project the find would serve, so the founder's weekly
// shortlist reads "OCR for eBill2Tally bills", not "document retrieval".
export interface ProjectNeed { key: string; projects: string; term: RegExp; weight: number; kinds?: CandidateKind[] }
export const PROJECT_NEEDS: ProjectNeed[] = [
  { key: "speech_to_text", projects: "SYROS OPD dictation, Rajeev AI call agent", weight: 4,
    term: /\b(speech[- ]to[- ]text|automatic-speech-recognition|asr|stt|whisper|transcri\w*|dictation)\b/i },
  { key: "text_to_speech", projects: "Rajeev AI voice (Hinglish, human tone)", weight: 3,
    term: /\b(text[- ]to[- ]speech|tts|voice clon\w*|voice agent|realtime voice|speech synthesis)\b/i },
  { key: "indian_languages", projects: "Hindi/Hinglish for SYROS, Rajeev AI and dealer apps", weight: 3,
    term: /\b(hindi|hinglish|indic|indian languages?|devanagari|punjabi|marathi|gujarati|bengali|tamil|telugu)\b/i },
  { key: "document_ocr", projects: "eBill2Tally bill scanning, knowledge library PDFs", weight: 4,
    term: /\b(ocr|invoice|receipt|bill scan\w*|document (parsing|extraction|understanding)|pdf (parsing|extraction|to markdown)|scanned)\b/i },
  { key: "knowledge_memory", projects: "FKAIOS one brain: memory over 622 chats", weight: 3,
    term: /\b(rag|retrieval|knowledge (base|graph)|long[- ]term memory|agent memory|embedding|vector (db|search|store))\b/i },
  { key: "browser_research", projects: "dealer and franchise prospect research (Gio Paints, GoMax)", weight: 3,
    term: /\b(browser (agent|automation|use)|computer[- ]use|playwright|puppeteer|web (research|agent)|google maps|lead (generation|research))\b/i },
  { key: "messaging_crm", projects: "WhatsApp + CRM for Turning Point, GoMax, Bhavishya Command", weight: 4,
    term: /\b(whatsapp|crm|hubspot|zoho|gmail|calendar|email (automation|agent)|lead management)\b/i },
  { key: "fkaios_stack", projects: "FKAIOS stack (Supabase, Postgres, Deno, GitHub)", weight: 3,
    term: /\b(supabase|postgres(ql)?|deno|edge functions?|github (actions|mcp))\b/i },
  { key: "deliverables", projects: "client proposals, decks and sheets", weight: 2,
    term: /\b(pptx|powerpoint|docx|word document|excel|xlsx|spreadsheet|slides|pdf generation)\b/i },
  { key: "business_ops", projects: "franchise, retail and restaurant clients", weight: 3,
    term: /\b(franchise|retail|restaurant|pos|inventory|dealer|distributor|accounting|tally|gst|invoic\w*)\b/i },
  { key: "agent_execution", projects: "FKAIOS objective loop execution", weight: 2,
    term: /\b(tool[- ]use|function[- ]calling|multi-agent|agent (framework|orchestration|harness)|autonomous agent|workflow automation)\b/i },
  { key: "free_llm_capacity", projects: "no-stop rule: another free model when a quota ends", weight: 3,
    term: /./, kinds: ["free_model"] },
  { key: "evaluation", projects: "FKAIOS verifier and capability tests", weight: 1,
    term: /\b(llm (eval\w*|testing)|evaluation (harness|framework)|benchmark(ing)? (agents|llms))\b/i },
];

// Things that look relevant to keyword matching but serve none of the needs.
export const NOISE_TERMS: Array<{ term: RegExp; reason: string }> = [
  { term: /\b(downloader|no[- ]watermark|tiktok|douyin|bilibili|youtube download\w*)\b/i, reason: "media downloader" },
  { term: /\b(crypto|blockchain|web3|defi|nft|trading bot|solana|ethereum)\b/i, reason: "crypto / trading" },
  { term: /\b(nsfw|porn|adult|hentai|deepfake|face[- ]?swap|undress)\b/i, reason: "unsafe content" },
  { term: /\b(jailbreak|cheat|aimbot|bypass (captcha|paywall|license))\b/i, reason: "abuse tooling" },
  { term: /(\bawesome[- ]list\b|\/awesome-)/i, reason: "link list, not a tool" },
  { term: /\b(minecraft|roblox|game mod|anime girl|waifu)\b/i, reason: "games / entertainment" },
];
export const NOISE_PENALTY = 6;

// A raw open-weights model only helps if it can actually run for FKAIOS
// (no GPU host today): its pipeline must match a need, and it needs a free API
// route to be adopted. Image/video generation pipelines serve no current need.
const IDLE_PIPELINES = /^(text-to-image|image-to-image|image-to-video|text-to-video|image-text-to-video|diffusion|unconditional-image-generation|text-to-3d|image-to-3d)/i;

export function scoreRelevance(c: Candidate): { score: number; reasons: string[] } {
  const text = `${c.name} ${c.description ?? ""}`;
  let score = 0;
  const reasons: string[] = [];
  let needs = 0;
  for (const n of PROJECT_NEEDS) {
    if (n.kinds && !n.kinds.includes(c.kind)) continue;
    if (n.term.test(text)) { score += n.weight; needs++; reasons.push(`${n.key.replace(/_/g, " ")} → ${n.projects}`); }
  }
  let noisy = false;
  for (const n of NOISE_TERMS) if (n.term.test(text)) { score -= NOISE_PENALTY; noisy = true; reasons.push(`penalty: ${n.reason}`); }
  // Noise is decisive: licence and popularity never lift it back into the shortlist.
  if (noisy) return { score: Math.min(score, -1), reasons };
  if (c.kind === "model" && IDLE_PIPELINES.test(c.description ?? "")) { score -= 3; reasons.push("penalty: image/video generation (no current need)"); }
  if (needs === 0) return { score: Math.min(score, 0), reasons: reasons.length ? reasons : ["no current project need"] };
  // Modifiers only matter once a real need is matched.
  if (c.kind === "mcp_server" && c.riskClass === "remote_service") { score += 1; reasons.push("hosted MCP (no install)"); }
  const license = (c.license ?? "").toLowerCase();
  if ((c.kind === "repository" || c.kind === "model") && /^(mit|apache-2\.0|bsd-[23]-clause|isc|mpl-2\.0)$/.test(license)) { score += 1; reasons.push(`permissive licence (${c.license})`); }
  // Popularity only breaks ties: at most +1.
  const stars = Number(c.metrics.stars ?? c.metrics.likes ?? 0);
  if (stars >= 1000) { score += 1; reasons.push("widely used"); }
  return { score, reasons };
}

export function clip(s: unknown, max = DESCRIPTION_MAX): string | null {
  if (typeof s !== "string") return null;
  // deno-lint-ignore no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? (t.length > max ? t.slice(0, max - 1) + "…" : t) : null;
}

export async function contentHash(c: Candidate): Promise<string> {
  const basis = JSON.stringify([c.name, c.description, c.version, c.license, c.kind, c.url]);
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// ---- source parsers (pure; tested against fixture payloads) ----

// deno-lint-ignore no-explicit-any
export function parseMcpRegistry(body: any): Candidate[] {
  const out: Candidate[] = [];
  for (const entry of Array.isArray(body?.servers) ? body.servers : []) {
    const s = entry?.server ?? entry;
    const meta = entry?._meta?.["io.modelcontextprotocol.registry/official"] ?? {};
    if (!s?.name || meta.status === "deleted" || meta.isLatest === false) continue;
    const remote = Array.isArray(s.remotes) && s.remotes.length > 0;
    const pkg = Array.isArray(s.packages) && s.packages.length > 0;
    const needsCreds = JSON.stringify(s.packages ?? []).match(/"isSecret"\s*:\s*true|API_KEY|TOKEN/i) != null || JSON.stringify(s.remotes ?? []).match(/authorization|api[_-]?key/i) != null;
    out.push({
      canonicalKey: `mcp:${String(s.name).toLowerCase()}`, source: "mcp_registry", kind: "mcp_server", name: String(s.title ?? s.name),
      url: s.repository?.url ?? s.websiteUrl ?? (remote ? String(s.remotes[0].url) : null), description: clip(s.description), version: s.version ? String(s.version) : null, license: null,
      metrics: { registry_name: s.name, published_at: meta.publishedAt ?? null, updated_at: meta.updatedAt ?? null, transports: remote ? s.remotes.map((r: { type?: string }) => r.type) : [], package_types: pkg ? s.packages.map((p: { registryType?: string }) => p.registryType) : [] },
      riskClass: needsCreds ? "requires_credentials" : pkg ? "executable_code" : remote ? "remote_service" : "metadata_only",
    });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export function parseGithubSearch(body: any): Candidate[] {
  return (Array.isArray(body?.items) ? body.items : []).filter((r: { full_name?: string; archived?: boolean; fork?: boolean }) => r?.full_name && !r.archived && !r.fork).map((r: Record<string, any>) => ({
    canonicalKey: `github:${String(r.full_name).toLowerCase()}`, source: "github" as const, kind: "repository" as const, name: String(r.full_name),
    url: r.html_url ?? null, description: clip(r.description), version: null, license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? String(r.license.spdx_id) : null,
    metrics: { stars: r.stargazers_count ?? 0, pushed_at: r.pushed_at ?? null, created_at: r.created_at ?? null, topics: Array.isArray(r.topics) ? r.topics.slice(0, 10) : [], language: r.language ?? null },
    riskClass: "executable_code" as const,
  }));
}

// deno-lint-ignore no-explicit-any
export function parseHuggingFace(body: any): Candidate[] {
  return (Array.isArray(body) ? body : []).filter((m: { id?: string; private?: boolean; gated?: unknown }) => m?.id && !m.private).map((m: Record<string, any>) => ({
    canonicalKey: `hf:${String(m.id).toLowerCase()}`, source: "huggingface" as const, kind: "model" as const, name: String(m.id),
    url: `https://huggingface.co/${m.id}`, description: clip([m.pipeline_tag, ...(Array.isArray(m.tags) ? m.tags.filter((t: string) => !t.includes(":")).slice(0, 12) : [])].filter(Boolean).join(", ")),
    version: null, license: Array.isArray(m.tags) ? (m.tags.find((t: string) => t.startsWith("license:"))?.slice(8) ?? null) : null,
    metrics: { likes: m.likes ?? 0, downloads: m.downloads ?? 0, trending: m.trendingScore ?? null, pipeline: m.pipeline_tag ?? null, created_at: m.createdAt ?? null, gated: m.gated ?? false },
    riskClass: "executable_code" as const,
  }));
}

// deno-lint-ignore no-explicit-any
export function parseOpenRouterFree(body: any): Candidate[] {
  return (Array.isArray(body?.data) ? body.data : []).filter((m: { id?: string; pricing?: Record<string, string> }) =>
    m?.id && m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0).map((m: Record<string, any>) => ({
    canonicalKey: `openrouter:${String(m.id).toLowerCase()}`, source: "openrouter" as const, kind: "free_model" as const, name: String(m.id),
    url: `https://openrouter.ai/${m.id}`, description: clip(m.description), version: null, license: null,
    metrics: { context_length: m.context_length ?? null, created: m.created ?? null, modalities: m.architecture?.input_modalities ?? null },
    riskClass: "requires_credentials" as const, // usable only through an OpenRouter key, which is optional
  }));
}

export interface SourceSpec { name: string; url: string; parse: (body: unknown) => Candidate[]; headers?: Record<string, string> }

export function sourceSpecs(now: Date, env: Env): SourceSpec[] {
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
  const gh: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "fkaios-discovery" };
  const token = env("GITHUB_TOKEN");
  if (token) gh.Authorization = `Bearer ${token}`;
  const ghq = (q: string) => `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
  return [
    { name: "mcp_registry", url: "https://registry.modelcontextprotocol.io/v0/servers?limit=100", parse: parseMcpRegistry },
    { name: "github_mcp", url: ghq(`topic:mcp-server pushed:>${since}`), parse: parseGithubSearch, headers: gh },
    { name: "github_agents", url: ghq(`topic:ai-agents pushed:>${since} stars:>200`), parse: parseGithubSearch, headers: gh },
    { name: "github_documents", url: ghq(`ocr pdf in:name,description pushed:>${since} stars:>100`), parse: parseGithubSearch, headers: gh },
    { name: "huggingface_trending", url: "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=40", parse: parseHuggingFace },
    { name: "openrouter_free", url: "https://openrouter.ai/api/v1/models", parse: parseOpenRouterFree },
  ];
}

async function fetchJson(fetcher: Fetcher, spec: SourceSpec): Promise<unknown> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetcher(spec.url, { headers: { Accept: "application/json", ...(spec.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.json();
      lastErr = `HTTP ${res.status}`;
      await res.body?.cancel();
      if (res.status !== 429 && res.status < 500) break; // not transient: do not retry
    } catch (e) { lastErr = String(e).slice(0, 160); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(lastErr);
}

export interface DiscoveryReport { runId: string; status: string; seen: number; new: number; updated: number; highValue: Array<Record<string, unknown>>; sources: Record<string, unknown>; evidence: string | null }

/** One discovery run. Upserts candidates by canonical key; changes are detected by content hash. */
export async function runEcosystemDiscovery(db: Db, trigger: "scheduled" | "manual" | "self_test", opts: { now?: Date; env?: Env; fetcher?: Fetcher; scheduleDate?: string | null } = {}): Promise<DiscoveryReport> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? ((k: string) => Deno.env.get(k));
  const fetcher = opts.fetcher ?? fetch;
  const { data: run, error } = await db.from("fkaios_discovery_runs").insert({ trigger, schedule_date: opts.scheduleDate ?? null, timezone: DISCOVERY_TIMEZONE, started_at: now.toISOString() }).select("id").single();
  if (error || !run) throw new Error(`could not open discovery run: ${error?.message ?? "no row"}`);
  const sources: Record<string, unknown> = {};
  const byKey = new Map<string, Candidate>();
  for (const spec of sourceSpecs(now, env)) {
    try {
      const parsed = spec.parse(await fetchJson(fetcher, spec));
      for (const c of parsed) if (!byKey.has(c.canonicalKey)) byKey.set(c.canonicalKey, c);
      sources[spec.name] = { ok: true, parsed: parsed.length };
    } catch (e) {
      sources[spec.name] = { ok: false, error: String(e).slice(0, 200) };
    }
  }
  const keys = [...byKey.keys()];
  const existing = new Map<string, { content_hash: string }>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await db.from("fkaios_ecosystem_candidates").select("canonical_key,content_hash").in("canonical_key", keys.slice(i, i + 200));
    for (const r of data ?? []) existing.set(r.canonical_key, r);
  }
  let created = 0, updated = 0;
  const highValue: Array<Record<string, unknown>> = [];
  const digestAll: DigestFind[] = [];   // every high-value find seen today
  const digestNew: DigestFind[] = [];   // high-value finds that are new or changed today
  const stamp = now.toISOString();
  for (const c of byKey.values()) {
    const hash = await contentHash(c);
    const { score, reasons } = scoreRelevance(c);
    const prev = existing.get(c.canonicalKey);
    if (score >= HIGH_VALUE_SCORE) {
      const f = { name: c.name, kind: c.kind, url: c.url, score, reasons };
      digestAll.push(f);
      if (!prev || prev.content_hash !== hash) digestNew.push(f);
    }
    const base = { source: c.source, kind: c.kind, name: c.name, url: c.url, description: c.description, version: c.version, license: c.license, metrics: c.metrics, content_hash: hash, relevance_score: score, relevance_reasons: reasons, risk_class: c.riskClass, last_seen_at: stamp, last_run_id: run.id };
    if (!prev) {
      const { error: insErr } = await db.from("fkaios_ecosystem_candidates").insert({ ...base, canonical_key: c.canonicalKey, first_seen_at: stamp, last_changed_at: stamp, first_run_id: run.id });
      if (!insErr) { created++; if (score >= HIGH_VALUE_SCORE) highValue.push({ key: c.canonicalKey, name: c.name, score, reasons, risk: c.riskClass, url: c.url }); }
    } else if (prev.content_hash !== hash) {
      await db.from("fkaios_ecosystem_candidates").update({ ...base, last_changed_at: stamp }).eq("canonical_key", c.canonicalKey);
      updated++;
    } else {
      // Unchanged content still gets today's score: the scoring rules change (29 Oct 2026: project-need scoring).
      await db.from("fkaios_ecosystem_candidates").update({ last_seen_at: stamp, last_run_id: run.id, relevance_score: score, relevance_reasons: reasons }).eq("canonical_key", c.canonicalKey);
    }
  }
  // Outer-world knowledge for the brain: one dated AI World digest per run (not for self-tests).
  if (trigger !== "self_test") {
    try {
      const date = localDateHour(now).date;
      let papers: Paper[] = [];
      try { papers = await fetchDailyPapers(fetcher, date); sources.research_papers = { ok: true, parsed: papers.length }; }
      catch (e) { sources.research_papers = { ok: false, error: String(e).slice(0, 200) }; }
      // The first digest ever carries every relevant find already known; later ones only what is new or changed.
      const { count: digests } = await db.from("fkaios_knowledge_sources").select("id", { count: "exact", head: true }).like("title", "AI World Radar:%");
      const finds = (digests ?? 0) === 0 ? digestAll : digestNew;
      finds.sort((a, b) => b.score - a.score);
      const written = await writeWorldDigest(db, date, buildWorldDigest(date, finds.slice(0, 25), papers));
      sources.world_digest = { ok: !written.error, pages: written.pages, finds: finds.length, papers: papers.length, error: written.error ?? null };
    } catch (e) {
      sources.world_digest = { ok: false, error: String(e).slice(0, 200) };
    }
  }
  const discoverySources = Object.entries(sources).filter(([k]) => k !== "world_digest" && k !== "research_papers").map(([, v]) => v);
  const okSources = discoverySources.filter((s) => (s as { ok: boolean }).ok).length;
  const total = discoverySources.length;
  const status = okSources === 0 ? "failed" : okSources < total ? "partial" : "completed";
  highValue.sort((a, b) => Number(b.score) - Number(a.score));
  const { data: ev } = await db.from("fkaios_verification_evidence").insert({
    requirement_key: "discovery:ecosystem_v1", evidence_type: "discovery_run", verifier: "deterministic:ecosystem_discovery", status: status === "failed" ? "failed" : "passed",
    observed_result: { run_id: run.id, trigger, sources, seen: byKey.size, new: created, updated, high_value: highValue.slice(0, 10) },
    verification_notes: `${trigger} discovery: ${okSources}/${total} sources answered; ${byKey.size} candidates seen, ${created} new, ${updated} changed, ${highValue.length} high-value. Nothing was installed or executed.`,
    verified_at: new Date().toISOString(),
  }).select("id").single();
  await db.from("fkaios_discovery_runs").update({ status, sources, seen_count: byKey.size, new_count: created, updated_count: updated, high_value: highValue.slice(0, 20), evidence_id: ev?.id ?? null, error: status === "failed" ? "no source answered" : null, finished_at: new Date().toISOString() }).eq("id", run.id);
  return { runId: run.id, status, seen: byKey.size, new: created, updated, highValue: highValue.slice(0, 10), sources, evidence: ev?.id ?? null };
}

/** The local calendar date and hour in the discovery timezone. */
export function localDateHour(now: Date, tz = DISCOVERY_TIMEZONE): { date: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Called every tick: runs the scheduled daily discovery once per local day after 06:00 IST. */
export async function runScheduledDiscoveryIfDue(db: Db, now = new Date()): Promise<DiscoveryReport | { skipped: string }> {
  const { date, hour } = localDateHour(now);
  if (hour < DISCOVERY_LOCAL_HOUR) return { skipped: `before ${DISCOVERY_LOCAL_HOUR}:00 ${DISCOVERY_TIMEZONE}` };
  const { data: today } = await db.from("fkaios_discovery_runs").select("id,status,started_at").eq("trigger", "scheduled").eq("schedule_date", date);
  const rows = (today ?? []) as Array<{ id: string; status: string; started_at: string }>;
  if (rows.some((r) => r.status !== "failed" && r.status !== "running")) return { skipped: `scheduled run for ${date} done` };
  // A run stuck in 'running' for 10 minutes died with its worker: mark it failed so it can be retried.
  for (const r of rows.filter((r) => r.status === "running")) {
    if (now.getTime() - new Date(r.started_at).getTime() < 10 * 60_000) return { skipped: `scheduled run for ${date} in progress` };
    await db.from("fkaios_discovery_runs").update({ status: "failed", error: "worker stopped before finishing", finished_at: now.toISOString() }).eq("id", r.id);
  }
  if (rows.filter((r) => r.status === "failed" || r.status === "running").length >= MAX_SCHEDULED_ATTEMPTS) return { skipped: `scheduled run for ${date} failed ${MAX_SCHEDULED_ATTEMPTS} times; next attempt tomorrow` };
  // The unique index admits one non-failed scheduled run per date: a concurrent tick loses the insert and stops.
  try {
    return await runEcosystemDiscovery(db, "scheduled", { now, scheduleDate: date });
  } catch (e) {
    return { skipped: `scheduled run not started: ${String(e).slice(0, 160)}` };
  }
}
