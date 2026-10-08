/// <reference lib="deno.ns" />
import { base64ToBytes, bytesToBase64, pcmToWav, rankSpeechResources, synthesize, transcribe, wordErrorRate, type SpeechResourceRow } from "./speech.ts";
import { parseGeminiSpeechModels } from "./capability-discovery.ts";
import { voiceTurn } from "./voice.ts";

function assert(condition: boolean, message = "assertion failed"): void {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n     got ${a}`);
}

function row(ref: string, over: Partial<SpeechResourceRow> = {}): SpeechResourceRow {
  const provider = ref.split(":")[1];
  return { capability: "speech_to_text", resource_ref: ref, provider, tier: "free_external", credential_ref: null, privacy_class: "external", lifecycle_state: "testing", health_status: "unknown", unavailable_until: null, ...over };
}
const env = (vars: Record<string, string>) => (k: string) => vars[k];

Deno.test("speech ranking: local first, untested and unconfigured resources are skipped with reasons", () => {
  const rows = [
    row("model:gemini:flash", { credential_ref: "GEMINI_API_KEY" }),
    row("tool:self_hosted:faster-whisper", { tier: "local", privacy_class: "local", credential_ref: "SELF_HOSTED_SPEECH_BASE_URL" }),
    row("model:openai:transcribe", { tier: "paid_premium", credential_ref: "OPENAI_API_KEY" }),
    row("model:gemini:new", { lifecycle_state: "discovered", credential_ref: "GEMINI_API_KEY" }),
  ];
  const withLocal = rankSpeechResources(rows, {}, env({ GEMINI_API_KEY: "x", SELF_HOSTED_SPEECH_BASE_URL: "http://h", OPENAI_API_KEY: "y" }));
  assertEquals(withLocal.ranked.map((r) => r.row.resource_ref), ["tool:self_hosted:faster-whisper", "model:gemini:flash"]);
  assert(withLocal.skipped.some((s) => s.ref === "model:openai:transcribe" && /spend not authorised/.test(s.reason)));
  assert(withLocal.skipped.some((s) => s.ref === "model:gemini:new" && /not evaluated/.test(s.reason)));
  const noLocal = rankSpeechResources(rows, {}, env({ GEMINI_API_KEY: "x" }));
  assertEquals(noLocal.ranked.map((r) => r.row.resource_ref), ["model:gemini:flash"]);
  assert(noLocal.skipped.some((s) => s.ref === "tool:self_hosted:faster-whisper" && /SELF_HOSTED_SPEECH_BASE_URL unset/.test(s.reason)));
  // paid only when spend is authorised; local-only privacy drops external resources
  assert(rankSpeechResources(rows, { allowPaid: true }, env({ OPENAI_API_KEY: "y" })).ranked.some((r) => r.row.resource_ref === "model:openai:transcribe"));
  assertEquals(rankSpeechResources(rows, { requirePrivacy: "local" }, env({ GEMINI_API_KEY: "x", SELF_HOSTED_SPEECH_BASE_URL: "h" })).ranked.map((r) => r.row.resource_ref), ["tool:self_hosted:faster-whisper"]);
});

Deno.test("speech ranking: health, cool-down, evidence and avoid list move resources, never hide them", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const rows = [
    row("model:gemini:a", { unavailable_until: "2026-10-08T13:00:00Z" }),
    row("model:gemini:b"),
    row("model:gemini:c", { lifecycle_state: "verified" }),
  ];
  assertEquals(rankSpeechResources(rows, {}, env({}), now).ranked.map((r) => r.row.resource_ref), ["model:gemini:c", "model:gemini:b", "model:gemini:a"]);
  assertEquals(rankSpeechResources(rows, { avoid: ["model:gemini:c"] }, env({}), now).ranked.map((r) => r.row.resource_ref), ["model:gemini:b", "model:gemini:a", "model:gemini:c"]);
});

Deno.test("word error rate is deterministic and normalised", () => {
  assertEquals(wordErrorRate("Franchise Kart helps entrepreneurs.", "franchise kart helps entrepreneurs"), 0);
  assertEquals(wordErrorRate("one two three four", "one two four"), 0.25);
  assertEquals(wordErrorRate("one two", "one two three four"), 1);
  assertEquals(wordErrorRate("", ""), 0);
});

Deno.test("audio helpers: base64 round trip and a valid WAV header", () => {
  const bytes = new Uint8Array(70000).map((_, i) => i % 251);
  assertEquals(Array.from(base64ToBytes(bytesToBase64(bytes)).slice(0, 10)), Array.from(bytes.slice(0, 10)));
  assertEquals(base64ToBytes(bytesToBase64(bytes)).length, bytes.length);
  const wav = pcmToWav(new Uint8Array(480), 24000);
  assertEquals(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assertEquals(new TextDecoder().decode(wav.slice(8, 12)), "WAVE");
  assertEquals(new DataView(wav.buffer).getUint32(24, true), 24000);
  assertEquals(wav.length, 44 + 480);
});

Deno.test("discovery registers provider speech models as text_to_speech candidates, not text models", () => {
  const body = { models: [
    { name: "models/gemini-9-flash-preview-tts", supportedGenerationMethods: ["generateContent"], displayName: "TTS" },
    { name: "models/gemini-9-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/embedding-9", supportedGenerationMethods: ["embedContent"] },
  ] };
  assertEquals(parseGeminiSpeechModels(body).map((m) => [m.capability, m.model]), [["text_to_speech", "gemini-9-flash-preview-tts"], ["speech_to_text", "gemini-9-flash"]]);
});

// ---- failover through a fake database and stubbed provider HTTP --------

function fakeDb(rows: SpeechResourceRow[]) {
  const steps: Record<string, unknown>[] = [];
  const updates: Array<{ ref: string; patch: Record<string, unknown> }> = [];
  const q = (table: string) => {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    let inserted: Record<string, unknown>[] | null = null;
    const api: Record<string, unknown> = {
      select: () => api, eq: (k: string, v: unknown) => { filters[k] = v; return api; }, in: () => api,
      update: (p: Record<string, unknown>) => { patch = p; return api; },
      insert: (r: Record<string, unknown>[]) => { inserted = r; return api; },
      maybeSingle: () => Promise.resolve({ data: { consecutive_failures: 0 } }),
      then: (resolve: (v: unknown) => void) => {
        if (table === "fkaios_execution_steps" && inserted) { steps.push(...inserted); return resolve({ data: inserted.map((_, i) => ({ id: `s${steps.length - inserted!.length + i}` })), error: null }); }
        if (patch) { updates.push({ ref: String(filters.resource_ref), patch }); return resolve({ data: null, error: null }); }
        return resolve({ data: rows.filter((r) => r.capability === filters.capability), error: null });
      },
    };
    return api;
  };
  return { db: { from: q }, steps, updates };
}

Deno.test("transcribe fails over from a quota-limited resource to the next and records both attempts", async () => {
  const rows = [row("model:gemini:a", { credential_ref: "GEMINI_API_KEY" }), row("model:gemini:b", { credential_ref: "GEMINI_API_KEY" })];
  const { db, steps, updates } = fakeDb(rows);
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    if (String(url).includes("/a:generateContent")) return Promise.resolve(new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }));
    return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"language":"en","text":"hello world"}' }] } }] }), { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await transcribe(db, { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" }, {}, { stepKind: "evaluation" }, env({ GEMINI_API_KEY: "k" }));
    assertEquals(r.status, "success");
    assertEquals(r.output?.text, "hello world");
    assertEquals(r.resourceRef, "model:gemini:b");
    assertEquals(steps.map((s) => [s.resource_ref, s.outcome, s.failure_category, s.switched_from_ref]), [["model:gemini:a", "failed", "rate_limit", null], ["model:gemini:b", "completed", null, "model:gemini:a"]]);
    assertEquals(steps[0].capability_ref, "capability:speech_to_text");
    assertEquals(steps[1].output_excerpt, null); // transcripts are not stored unless asked
    assert(updates.some((u) => u.ref === "model:gemini:a" && u.patch.last_failure_category === "rate_limit" && !!u.patch.unavailable_until));
  } finally { globalThis.fetch = realFetch; }
});

Deno.test("no usable resource is a truthful failure that names why, not a fake success", async () => {
  const { db } = fakeDb([row("tool:self_hosted:faster-whisper", { tier: "local", credential_ref: "SELF_HOSTED_SPEECH_BASE_URL" })]);
  const r = await transcribe(db, { bytes: new Uint8Array([1]), mimeType: "audio/wav" }, {}, { stepKind: "evaluation" }, env({}));
  assertEquals(r.status, "failed");
  assert(/SELF_HOSTED_SPEECH_BASE_URL unset/.test(r.failure ?? ""), r.failure ?? "");
});

Deno.test("synthesize wraps provider PCM as WAV; voice turn runs the responder between the two legs", async () => {
  const pcm = bytesToBase64(new Uint8Array(4800));
  const rows: SpeechResourceRow[] = [
    { ...row("model:gemini:tts"), capability: "text_to_speech" },
    row("model:gemini:stt"),
  ];
  const { db } = fakeDb(rows);
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) => String(url).includes("/tts:")
    ? Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm } }] } }] }), { status: 200 }))
    : Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"language":"en","text":"what is two plus three"}' }] } }] }), { status: 200 }))) as typeof fetch;
  try {
    const s = await synthesize(db, "hello", null, {}, { stepKind: "evaluation" }, env({}));
    assertEquals(s.output?.mimeType, "audio/wav");
    assertEquals(s.output?.audio.length, 44 + 4800);
    // voice turn uses Deno.env for credentials; resources here need none
    const turn = await voiceTurn(db, { bytes: new Uint8Array([1]), mimeType: "audio/wav" }, (t) => Promise.resolve({ text: `You asked: ${t}. Five.` }));
    assertEquals(turn.status, "completed");
    assertEquals(turn.transcript, "what is two plus three");
    assertEquals(turn.resources, { speech_to_text: "model:gemini:stt", text_to_speech: "model:gemini:tts" });
    assert(turn.audio !== null && turn.audio.mimeType === "audio/wav");
  } finally { globalThis.fetch = realFetch; }
});

import { pickSpeechCandidate } from "./speech-evaluation.ts";

Deno.test("speech evaluation picks configured, untested, unpaid resources, local first, and not twice a day", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const rows = [
    { ...row("model:gemini:tts", { lifecycle_state: "discovered", credential_ref: "GEMINI_API_KEY" }), capability: "text_to_speech" },
    { ...row("tool:self_hosted:kokoro", { lifecycle_state: "discovered", tier: "local", credential_ref: "SELF_HOSTED_SPEECH_BASE_URL" }), capability: "text_to_speech" },
    { ...row("model:openai:tts", { lifecycle_state: "discovered", tier: "paid_premium", credential_ref: "OPENAI_API_KEY" }), capability: "text_to_speech" },
    row("model:gemini:verified", { lifecycle_state: "verified" }),
  ];
  assertEquals(pickSpeechCandidate(rows, env({ GEMINI_API_KEY: "k", OPENAI_API_KEY: "k" }), now)?.resource_ref, "model:gemini:tts");
  assertEquals(pickSpeechCandidate(rows, env({ GEMINI_API_KEY: "k", SELF_HOSTED_SPEECH_BASE_URL: "h" }), now)?.resource_ref, "tool:self_hosted:kokoro");
  const triedToday = rows.map((r) => r.resource_ref === "model:gemini:tts" ? { ...r, metadata: { last_eval_at: "2026-10-08T06:00:00Z" } } : r);
  assertEquals(pickSpeechCandidate(triedToday, env({ GEMINI_API_KEY: "k" }), now), null);
});

Deno.test("speech evaluation: a partner-leg failure does not hold the candidate back for a day", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const base = { ...row("model:gemini:tts", { lifecycle_state: "discovered", credential_ref: "GEMINI_API_KEY" }), capability: "text_to_speech" };
  const partnerFailed = { ...base, metadata: { last_eval_at: "2026-10-08T11:20:00Z", last_eval_result: "partner_unavailable" } };
  assertEquals(pickSpeechCandidate([partnerFailed], env({ GEMINI_API_KEY: "k" }), now)?.resource_ref, "model:gemini:tts");
  const ownFailure = { ...base, metadata: { last_eval_at: "2026-10-08T11:20:00Z", last_eval_result: "failed" } };
  assertEquals(pickSpeechCandidate([ownFailure], env({ GEMINI_API_KEY: "k" }), now), null);
});

Deno.test("word error rate treats spoken and written numbers alike but still counts omissions", () => {
  assertEquals(wordErrorRate("What is two plus three?", "What is 2 + 3?"), 0);
  assertEquals(wordErrorRate("Two plus three is five.", "2 + 3 = 5"), 0.2); // 'is' vs 'equals' is a real difference
  assertEquals(wordErrorRate("What is two plus three? Answer in one short sentence.", "What is 2 + 3?"), 0.5);
});

import { sttTimeoutMs, ttsTimeoutMs } from "./speech.ts";

Deno.test("speech timeouts scale with the work and stay bounded", () => {
  assertEquals(ttsTimeoutMs("What is two plus three? Answer in one short sentence."), 15000 + 53 * 40);
  assertEquals(ttsTimeoutMs("x".repeat(5000)), 60000);
  assertEquals(sttTimeoutMs(221370), 20000 + 216 * 60);
  assertEquals(sttTimeoutMs(50 * 1024 * 1024), 90000);
});
