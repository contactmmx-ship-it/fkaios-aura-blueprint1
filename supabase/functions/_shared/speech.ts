// SPEECH CAPABILITIES — speech_to_text and text_to_speech as FKAIOS
// capabilities, not as vendor integrations. Callers ask for a capability; the
// resources that can provide it come from fkaios_resource_capabilities and are
// ranked here (tier, health, lifecycle, privacy, credential presence). A
// failing resource is classified and the next one is tried; every attempt is
// an fkaios_execution_steps row with capability_ref capability:<name>.
//
// Voice is a modality. Nothing in this file knows anything about the business:
// it turns audio into text and text into audio, with evidence.
//
// Adapters: Gemini (audio input for STT, TTS models for speech), any
// OpenAI-compatible speech server (faster-whisper / Kokoro / Piper behind
// speaches, Kokoro-FastAPI or openedai-speech: the local/free path),
// ElevenLabs and OpenAI (paid). Credentials are read from the environment by
// name (credential_ref); no value is ever stored, logged or returned.

import { classifyLLMFailure, type FailureCategory } from "./llm-router.ts";
import { parseRef } from "./resource-identity.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type SpeechCapability = "speech_to_text" | "text_to_speech";

export interface SpeechResourceRow {
  capability: string;
  resource_ref: string;
  provider: string;
  tier: string;
  credential_ref: string | null;
  privacy_class: string;
  lifecycle_state: string;
  health_status: string;
  unavailable_until: string | null;
  consecutive_failures?: number;
  metadata?: Record<string, unknown> | null;
}

export interface SpeechSelectionOptions {
  /** Self-tests may try resources still under test; production uses only tested ones. */
  includeUntested?: boolean;
  /** Resources to try last (e.g. the resource that produced the audio being checked). */
  avoid?: string[];
  /** Resources never to use. */
  exclude?: string[];
  /** 'local' keeps the audio on infrastructure FKAIOS controls. */
  requirePrivacy?: "local" | "self_hosted" | "external";
  /** Paid resources are used only when the caller allows it (spend is a governed decision). */
  allowPaid?: boolean;
}

export interface RankedSpeechResource { row: SpeechResourceRow; reason: string }
export interface SpeechSelection { ranked: RankedSpeechResource[]; skipped: Array<{ ref: string; reason: string }> }

// Local first, then free, then paid: cost is one factor, so health, lifecycle
// and evidence can still move a resource down (see rankSpeechResources).
const TIER_ORDER = ["local", "self_hosted", "internal", "free_external", "low_cost_external", "paid_premium"];
const TESTED = new Set(["testing", "verified", "candidate", "adopted", "monitored"]);
const PRIVACY_RANK: Record<string, number> = { local: 0, self_hosted: 1, external: 2 };

export function credentialPresent(credentialRef: string | null, env: (k: string) => string | undefined): boolean {
  if (!credentialRef) return true;
  return !!env(credentialRef);
}

/** Pure ranking: which resources may provide this capability now, in what order, and why the rest were skipped. */
export function rankSpeechResources(rows: SpeechResourceRow[], opts: SpeechSelectionOptions, env: (k: string) => string | undefined, now = new Date()): SpeechSelection {
  const skipped: Array<{ ref: string; reason: string }> = [];
  const avoid = new Set(opts.avoid ?? []);
  const exclude = new Set(opts.exclude ?? []);
  const usable: Array<{ row: SpeechResourceRow; score: number; reason: string }> = [];
  for (const row of rows) {
    const ref = row.resource_ref;
    if (exclude.has(ref)) { skipped.push({ ref, reason: "excluded" }); continue; }
    if (row.lifecycle_state === "retired") { skipped.push({ ref, reason: "retired" }); continue; }
    if (!opts.includeUntested && !TESTED.has(row.lifecycle_state)) { skipped.push({ ref, reason: `lifecycle ${row.lifecycle_state}: not evaluated` }); continue; }
    if (!credentialPresent(row.credential_ref, env)) { skipped.push({ ref, reason: `not configured (${row.credential_ref} unset)` }); continue; }
    if (row.tier === "paid_premium" && !opts.allowPaid) { skipped.push({ ref, reason: "paid resource; spend not authorised for this call" }); continue; }
    if (opts.requirePrivacy && (PRIVACY_RANK[row.privacy_class] ?? 2) > (PRIVACY_RANK[opts.requirePrivacy] ?? 2)) { skipped.push({ ref, reason: `privacy ${row.privacy_class} exceeds ${opts.requirePrivacy}` }); continue; }
    const cooling = row.unavailable_until && new Date(row.unavailable_until).getTime() > now.getTime();
    let score = TIER_ORDER.indexOf(row.tier) < 0 ? TIER_ORDER.length : TIER_ORDER.indexOf(row.tier);
    const notes = [`tier ${row.tier}`];
    if (row.lifecycle_state === "verified" || row.lifecycle_state === "adopted" || row.lifecycle_state === "monitored") { score -= 0.5; notes.push("verified by evidence"); }
    if (row.health_status === "degraded") { score += 2; notes.push("degraded"); }
    if (cooling) { score += 10; notes.push(`cooling down until ${row.unavailable_until}`); }
    if (avoid.has(ref)) { score += 20; notes.push("avoided"); }
    usable.push({ row, score, reason: notes.join(", ") });
  }
  usable.sort((a, b) => a.score - b.score || a.row.resource_ref.localeCompare(b.row.resource_ref));
  return { ranked: usable.map((u) => ({ row: u.row, reason: u.reason })), skipped };
}

// ---- audio helpers -----------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Wraps raw 16-bit little-endian PCM in a WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/** Word error rate (word-level edit distance / reference length) on normalised text. Deterministic: the scorer is code, not a model. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const r = norm(reference), h = norm(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[h.length] / r.length;
}

// ---- adapters ----------------------------------------------------------

export interface AudioInput { bytes: Uint8Array; mimeType: string; languageHint?: string }
export interface TranscriptionOutput { text: string; language: string | null; segments: Array<{ start: number; end: number; text: string }> | null; confidence: number | null }
export interface SynthesisOutput { audio: Uint8Array; mimeType: string; voice: string | null }

class SpeechCallError extends Error {
  constructor(public category: FailureCategory, message: string) { super(message); }
}

async function failFrom(res: Response, model: string, started: number): Promise<never> {
  const bodyText = await res.text().catch(() => "");
  let rawBody: unknown = bodyText;
  try { rawBody = JSON.parse(bodyText); } catch { /* keep text */ }
  const c = classifyLLMFailure({ ok: false, httpStatus: res.status, rawBody, latencyMs: Date.now() - started, model });
  throw new SpeechCallError(c.category, `HTTP ${res.status}: ${c.detail}`.slice(0, 400));
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SpeechCallError(/timed? ?out|abort/i.test(msg) ? "timeout" : "provider_outage", msg.slice(0, 300));
  }
}

function modelName(ref: string): string { return parseRef(ref)?.name ?? ref; }

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TRANSCRIBE_PROMPT = "Transcribe this audio verbatim. Do not translate, summarise or correct it. Respond with ONLY JSON: {\"language\": \"<BCP-47 code>\", \"text\": \"<transcript>\"}";

async function transcribeGemini(ref: string, audio: AudioInput, env: (k: string) => string | undefined): Promise<TranscriptionOutput> {
  const started = Date.now();
  const model = modelName(ref);
  const res = await timedFetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env("GEMINI_API_KEY") ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: audio.mimeType, data: bytesToBase64(audio.bytes) } }, { text: TRANSCRIBE_PROMPT + (audio.languageHint ? ` Expected language: ${audio.languageHint}.` : "") }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  }, 60000);
  if (!res.ok) await failFrom(res, model, started);
  const body = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  let parsed: { text?: string; language?: string } = {};
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { parsed = { text: raw }; }
  const text = String(parsed.text ?? "").trim();
  if (!text) throw new SpeechCallError("invalid_response", "empty transcript");
  return { text, language: parsed.language ? String(parsed.language) : null, segments: null, confidence: null };
}

async function synthesizeGemini(ref: string, text: string, voice: string | null, env: (k: string) => string | undefined): Promise<SynthesisOutput> {
  const started = Date.now();
  const model = modelName(ref);
  const voiceName = voice ?? "Kore";
  const res = await timedFetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env("GEMINI_API_KEY") ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
    }),
  }, 90000);
  if (!res.ok) await failFrom(res, model, started);
  const body = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
  const part = (body.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new SpeechCallError("invalid_response", "no audio in response");
  const mime = part.inlineData.mimeType ?? "audio/L16;rate=24000";
  const pcm = base64ToBytes(part.inlineData.data);
  if (/L16|pcm/i.test(mime)) {
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
    return { audio: pcmToWav(pcm, rate), mimeType: "audio/wav", voice: voiceName };
  }
  return { audio: pcm, mimeType: mime, voice: voiceName };
}

function openAICompatBase(ref: string, env: (k: string) => string | undefined): { base: string; key: string | undefined } {
  if (ref.startsWith("tool:self_hosted:")) return { base: (env("SELF_HOSTED_SPEECH_BASE_URL") ?? "").replace(/\/+$/, ""), key: env("SELF_HOSTED_SPEECH_API_KEY") };
  return { base: "https://api.openai.com", key: env("OPENAI_API_KEY") };
}

async function transcribeOpenAICompat(ref: string, row: SpeechResourceRow, audio: AudioInput, env: (k: string) => string | undefined): Promise<TranscriptionOutput> {
  const started = Date.now();
  const { base, key } = openAICompatBase(ref, env);
  const model = String(row.metadata?.model_id ?? (ref.startsWith("tool:self_hosted:") ? env("SELF_HOSTED_STT_MODEL") ?? "Systran/faster-whisper-small" : modelName(ref)));
  const form = new FormData();
  const ext = audio.mimeType.includes("wav") ? "wav" : audio.mimeType.includes("mpeg") ? "mp3" : audio.mimeType.includes("ogg") ? "ogg" : "webm";
  form.append("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }), `audio.${ext}`);
  form.append("model", model);
  form.append("response_format", ref.startsWith("tool:self_hosted:") ? "verbose_json" : "json");
  if (audio.languageHint) form.append("language", audio.languageHint.slice(0, 2));
  const res = await timedFetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form }, 120000);
  if (!res.ok) await failFrom(res, model, started);
  const body = await res.json() as { text?: string; language?: string; segments?: Array<{ start: number; end: number; text: string; avg_logprob?: number }> };
  const text = String(body.text ?? "").trim();
  if (!text) throw new SpeechCallError("invalid_response", "empty transcript");
  const segs = Array.isArray(body.segments) ? body.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })) : null;
  const lp = Array.isArray(body.segments) && body.segments.length ? body.segments.reduce((a, s) => a + (s.avg_logprob ?? 0), 0) / body.segments.length : null;
  return { text, language: body.language ?? null, segments: segs, confidence: lp === null ? null : Math.round(Math.exp(lp) * 1000) / 1000 };
}

async function synthesizeOpenAICompat(ref: string, row: SpeechResourceRow, text: string, voice: string | null, env: (k: string) => string | undefined): Promise<SynthesisOutput> {
  const started = Date.now();
  const { base, key } = openAICompatBase(ref, env);
  const local = ref.startsWith("tool:self_hosted:");
  const model = String(row.metadata?.model_id ?? (local ? env("SELF_HOSTED_TTS_MODEL") ?? "kokoro" : modelName(ref)));
  const v = voice ?? (local ? env("SELF_HOSTED_TTS_VOICE") ?? "af_heart" : "alloy");
  const res = await timedFetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, input: text, voice: v, response_format: "wav" }),
  }, 120000);
  if (!res.ok) await failFrom(res, model, started);
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.length < 100) throw new SpeechCallError("invalid_response", "audio too short");
  return { audio, mimeType: res.headers.get("content-type") ?? "audio/wav", voice: v };
}

async function synthesizeElevenLabs(text: string, voice: string | null, env: (k: string) => string | undefined): Promise<SynthesisOutput> {
  const started = Date.now();
  const voiceId = voice ?? env("AVATAR_VOICE_ID") ?? "21m00Tcm4TlvDq8ikWAM";
  const res = await timedFetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY") ?? "", "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
  }, 90000);
  if (!res.ok) await failFrom(res, "eleven_multilingual_v2", started);
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.length < 100) throw new SpeechCallError("invalid_response", "audio too short");
  return { audio, mimeType: "audio/mpeg", voice: voiceId };
}

async function callTranscribe(row: SpeechResourceRow, audio: AudioInput, env: (k: string) => string | undefined): Promise<TranscriptionOutput> {
  if (row.provider === "gemini") return await transcribeGemini(row.resource_ref, audio, env);
  if (row.provider === "self_hosted" || row.provider === "openai") return await transcribeOpenAICompat(row.resource_ref, row, audio, env);
  throw new SpeechCallError("invalid_request", `no speech_to_text adapter for provider ${row.provider}`);
}

async function callSynthesize(row: SpeechResourceRow, text: string, voice: string | null, env: (k: string) => string | undefined): Promise<SynthesisOutput> {
  if (row.provider === "gemini") return await synthesizeGemini(row.resource_ref, text, voice, env);
  if (row.provider === "self_hosted" || row.provider === "openai") return await synthesizeOpenAICompat(row.resource_ref, row, text, voice, env);
  if (row.provider === "elevenlabs") return await synthesizeElevenLabs(text, voice, env);
  throw new SpeechCallError("invalid_request", `no text_to_speech adapter for provider ${row.provider}`);
}

// ---- orchestration: select, try, fail over, record ---------------------

export interface SpeechAttempt { ref: string; outcome: "completed" | "failed"; category: FailureCategory | null; error: string | null; durationMs: number }
export interface SpeechContext {
  stepKind: "task_execution" | "evaluation";
  objectiveId?: string | null;
  taskId?: string | null;
  jobId?: string | null;
  /** Store a short excerpt of the transcript or input text on the evidence row. Off by default: speech can be personal. */
  storeExcerpt?: boolean;
}

const COOLDOWN_MIN: Partial<Record<FailureCategory, number>> = { rate_limit: 15, model_unavailable: 24 * 60, timeout: 5, invalid_response: 5, provider_outage: 10, credit_exhaustion: 60, authentication_failure: 60 };

async function loadRows(db: Db, capability: SpeechCapability): Promise<SpeechResourceRow[]> {
  const { data, error } = await db.from("fkaios_resource_capabilities")
    .select("capability,resource_ref,provider,tier,credential_ref,privacy_class,lifecycle_state,health_status,unavailable_until,consecutive_failures,metadata")
    .eq("capability", capability);
  if (error) throw new Error(`resource capability lookup failed: ${error.message}`);
  return (data ?? []) as SpeechResourceRow[];
}

async function recordAttempts(db: Db, capability: SpeechCapability, ctx: SpeechContext, attempts: SpeechAttempt[], selection: SpeechSelection, excerpt: string | null, startedAt: Date): Promise<string[]> {
  let cursor = startedAt.getTime();
  let prev: string | null = null;
  const rows = attempts.map((a, i) => {
    const parsed = parseRef(a.ref);
    const started = new Date(cursor);
    cursor += a.durationMs;
    const row = {
      objective_id: ctx.objectiveId ?? null, task_id: ctx.taskId ?? null, job_id: ctx.jobId ?? null,
      step_kind: ctx.stepKind, task_class: capability, resource_ref: a.ref, provider: parsed?.provider ?? null,
      model: parsed?.kind === "model" ? parsed.name : null, tool_ref: parsed?.kind === "tool" ? a.ref : null,
      capability_ref: `capability:${capability}`, attempt: i + 1, switched_from_ref: prev,
      selection: i === 0 ? { order: selection.ranked.map((r) => r.row.resource_ref), reasons: selection.ranked.map((r) => r.reason), skipped: selection.skipped.slice(0, 20) } : {},
      started_at: started.toISOString(), finished_at: new Date(cursor).toISOString(), duration_ms: a.durationMs,
      cost_usd: 0, outcome: a.outcome, failure_category: a.category, error: a.error,
      output_excerpt: a.outcome === "completed" && ctx.storeExcerpt && excerpt ? excerpt.slice(0, 500) : null,
    };
    prev = a.ref;
    return row;
  });
  const now = new Date();
  for (const a of attempts) {
    try {
      if (a.outcome === "completed") {
        await db.from("fkaios_resource_capabilities").update({ health_status: "available", consecutive_failures: 0, unavailable_until: null, last_success_at: now.toISOString(), updated_at: now.toISOString() }).eq("capability", capability).eq("resource_ref", a.ref);
      } else {
        const cool = a.category ? COOLDOWN_MIN[a.category] : undefined;
        const { data: cur } = await db.from("fkaios_resource_capabilities").select("consecutive_failures").eq("capability", capability).eq("resource_ref", a.ref).maybeSingle();
        await db.from("fkaios_resource_capabilities").update({
          health_status: a.category === "model_unavailable" || a.category === "authentication_failure" || a.category === "credit_exhaustion" ? "unavailable" : "degraded",
          unavailable_until: cool ? new Date(now.getTime() + cool * 60_000).toISOString() : null,
          consecutive_failures: Number(cur?.consecutive_failures ?? 0) + 1, last_failure_at: now.toISOString(), last_failure_category: a.category, updated_at: now.toISOString(),
        }).eq("capability", capability).eq("resource_ref", a.ref);
      }
    } catch { /* telemetry only */ }
  }
  try {
    const { data, error } = await db.from("fkaios_execution_steps").insert(rows).select("id");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } catch (err) {
    console.error(JSON.stringify({ level: "WARN", message: "speech evidence write failed (non-blocking)", error: err instanceof Error ? err.message : String(err) }));
    return [];
  }
}

export interface SpeechResult<T> { status: "success" | "failed"; output: T | null; resourceRef: string | null; attempts: SpeechAttempt[]; stepIds: string[]; selection: SpeechSelection; failure: string | null }

async function runWithFailover<T>(db: Db, capability: SpeechCapability, opts: SpeechSelectionOptions, ctx: SpeechContext, env: (k: string) => string | undefined,
  call: (row: SpeechResourceRow) => Promise<T>, excerptOf: (out: T) => string | null): Promise<SpeechResult<T>> {
  const selection = rankSpeechResources(await loadRows(db, capability), opts, env);
  const attempts: SpeechAttempt[] = [];
  const startedAt = new Date();
  for (const { row } of selection.ranked) {
    const t0 = Date.now();
    try {
      const out = await call(row);
      attempts.push({ ref: row.resource_ref, outcome: "completed", category: null, error: null, durationMs: Date.now() - t0 });
      const stepIds = await recordAttempts(db, capability, ctx, attempts, selection, excerptOf(out), startedAt);
      return { status: "success", output: out, resourceRef: row.resource_ref, attempts, stepIds, selection, failure: null };
    } catch (err) {
      const category: FailureCategory = err instanceof SpeechCallError ? err.category : "provider_outage";
      attempts.push({ ref: row.resource_ref, outcome: "failed", category, error: (err instanceof Error ? err.message : String(err)).slice(0, 400), durationMs: Date.now() - t0 });
    }
  }
  const stepIds = attempts.length ? await recordAttempts(db, capability, ctx, attempts, selection, null, startedAt) : [];
  const failure = selection.ranked.length === 0
    ? `no usable ${capability} resource: ${selection.skipped.map((s) => `${s.ref} (${s.reason})`).join("; ") || "none registered"}`
    : `all ${capability} resources failed: ${attempts.map((a) => `${a.ref} ${a.category}`).join("; ")}`;
  return { status: "failed", output: null, resourceRef: null, attempts, stepIds, selection, failure };
}

export async function transcribe(db: Db, audio: AudioInput, opts: SpeechSelectionOptions = {}, ctx: SpeechContext = { stepKind: "task_execution" }, env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Promise<SpeechResult<TranscriptionOutput>> {
  if (!audio.bytes.length) throw new Error("empty audio");
  return await runWithFailover(db, "speech_to_text", opts, ctx, env, (row) => callTranscribe(row, audio, env), (o) => o.text);
}

export async function synthesize(db: Db, text: string, voice: string | null = null, opts: SpeechSelectionOptions = {}, ctx: SpeechContext = { stepKind: "task_execution" }, env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Promise<SpeechResult<SynthesisOutput>> {
  if (!text.trim()) throw new Error("empty text");
  return await runWithFailover(db, "text_to_speech", opts, ctx, env, (row) => callSynthesize(row, text, voice, env), () => text);
}
