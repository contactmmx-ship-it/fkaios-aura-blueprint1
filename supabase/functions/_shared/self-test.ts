// PRODUCTION SELF-TEST — exercises the real execution paths against the real
// configured resources, without creating an objective or touching any
// approval gate. A row in fkaios_self_tests with status 'requested' makes the
// next founder-brain tick run these scenarios and record the results:
//   model_failover   a model the provider does not serve fails as
//                    model_unavailable and the next model of the same
//                    provider answers (resource switch recorded as evidence)
//   continuation     a response cut off at the output-token limit is
//                    continued from a checkpoint until complete
//   verifier_reject  the independent verifier rejects a wrong deliverable
//   verifier_pass    the independent verifier passes a correct one
//   speech_roundtrip known text ─► text_to_speech ─► speech_to_text (another
//                    resource) ─► word error rate, scored by code
//   structured_routing the executive engines' call path (routedStructuredCall):
//                    a schema-bound reasoning request is served by whatever
//                    resource selection picks, the reply is schema-checked
//   voice_turn       spoken question ─► STT ─► responder ─► TTS ─► STT back;
//                    the answer and the reply audio are both checked
// Speech scenarios use free and local resources only (paid ones need a spend decision).

import { buildDefaultRouterConfig, callLLMOnResources, type ExecutionResource, type LLMRequest } from "./llm-router.ts";
import { selectResources } from "./resource-selection.ts";
import { recordLLMAttempts } from "./execution-evidence.ts";
import { callWithContinuation } from "./continuation.ts";
import { verifyObjective } from "./objective-verifier.ts";
import { markStepsVerified } from "./execution-evidence.ts";
import { synthesize, transcribe, wordErrorRate } from "./speech.ts";
import { voiceTurn } from "./voice.ts";
import { routedStructuredCall } from "./structured-reasoning.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

interface ScenarioResult { scenario: string; passed: boolean; details: Record<string, unknown> }

const NONEXISTENT_MODEL = "fkaios-selftest-model-that-does-not-exist";

async function modelFailover(db: Db): Promise<ScenarioResult> {
  const sel = await selectResources(db, "general");
  const real = sel.resources.find((r) => r.provider === "gemini") ?? sel.resources[0];
  if (!real) return { scenario: "model_failover", passed: false, details: { error: "no production resource available" } };
  const fake: ExecutionResource = { ref: `model:${real.provider}:${NONEXISTENT_MODEL}`, provider: real.provider, model: NONEXISTENT_MODEL };
  const started = new Date();
  const r = await callLLMOnResources({ systemPrompt: "Return ONLY JSON.", userContent: 'Return {"ok": true}.', functionName: "self-test", functionClass: "background_agent", temperature: 0, maxTokens: 64 }, buildDefaultRouterConfig(), [fake, real]);
  await recordLLMAttempts(db, { stepKind: "evaluation", taskClass: "general" }, r.log, sel, r.content ?? null, started);
  const cats = r.log.attempts.map((a) => a.failureCategory);
  return { scenario: "model_failover", passed: r.status === "success" && r.resource?.ref === real.ref && cats[0] === "model_unavailable",
    details: { attempts: r.log.attempts.map((a) => ({ model: a.model, outcome: a.outcome, category: a.failureCategory })), served_by: r.resource?.ref ?? null } };
}

async function continuation(db: Db): Promise<ScenarioResult> {
  const sel = await selectResources(db, "writing");
  const request: LLMRequest = { systemPrompt: "You are a writer. Plain text only.", userContent: "Write exactly 5 numbered sentences about how a franchise network grows, one per line, then the line END.", functionName: "self-test", functionClass: "background_agent", temperature: 0, maxTokens: 40 };
  const route = async (req: LLMRequest) => {
    const started = new Date();
    const r = await callLLMOnResources(req, buildDefaultRouterConfig(), sel.resources);
    await recordLLMAttempts(db, { stepKind: req.userContent.includes("[CONTINUATION CHECKPOINT") ? "continuation" : "evaluation", taskClass: "writing" }, r.log, sel, r.content ?? null, started);
    return r;
  };
  try {
    const out = await callWithContinuation(route, request, 4);
    // Complete = the closing marker arrived and all five numbered sentences are present (nothing restarted or lost).
    const endsWithEnd = /END\W*$/.test(out.text.trim());
    const numbered = [1, 2, 3, 4, 5].filter((n) => new RegExp(`(^|\\s)${n}[.)]`).test(out.text)).length;
    const restarted = (out.text.match(/(^|\s)1[.)]/g) ?? []).length > 1;
    const doubled = /\b(\w{4,})\1\b/i.exec(out.text)?.[0] ?? null; // a seam that repeated a word without merging it
    return { scenario: "continuation", passed: out.continuations >= 1 && endsWithEnd && numbered === 5 && !restarted && !doubled,
      details: { continuations: out.continuations, chars: out.text.length, ends_with_end: endsWithEnd, numbered_sentences: numbered, restarted, doubled, text: out.text.slice(0, 2000) } };
  } catch (err) {
    return { scenario: "continuation", passed: false, details: { error: err instanceof Error ? err.message : String(err) } };
  }
}

async function verifier(db: Db, good: boolean): Promise<ScenarioResult> {
  const objective = "List the three primary colours of light, and say which two of them combine to make yellow light.";
  const deliverable = good
    ? "The three primary colours of light are red, green and blue. Red and green light combine to make yellow light."
    : "The three primary colours of light are red, yellow and blue. Blue and yellow light combine to make green light.";
  const v = await verifyObjective(db, { objectiveId: null, requirementKey: "self_test:objective_verifier", projectId: null, objective, criteria: [], deliverable, evidence: "", producerRefs: [], producingTaskIds: [] });
  const expected = good;
  return { scenario: good ? "verifier_pass" : "verifier_reject", passed: v.available && v.passed === expected,
    details: { verdict: v.passed, available: v.available, quality: v.quality, verifier: v.verifierRef, independence: v.independence, issues: v.issues.slice(0, 4), evidence_id: v.evidenceId ?? null } };
}


const ROUNDTRIP_TEXT = "Franchise Kart helps entrepreneurs open new franchise outlets across India.";
const SPEECH_CTX = { stepKind: "evaluation" as const, storeExcerpt: true };
const WER_PASS = 0.2;

async function promoteOnEvidence(db: Db, capability: string, ref: string | null, evidenceId: string | null): Promise<void> {
  if (!ref || !evidenceId) return;
  await db.from("fkaios_resource_capabilities").update({ lifecycle_state: "verified", evidence_id: evidenceId, updated_at: new Date().toISOString() })
    .eq("capability", capability).eq("resource_ref", ref).in("lifecycle_state", ["discovered", "available", "testing"]);
}

async function speechRoundtrip(db: Db): Promise<ScenarioResult> {
  const tts = await synthesize(db, ROUNDTRIP_TEXT, null, { includeUntested: true }, SPEECH_CTX);
  if (tts.status !== "success" || !tts.output) {
    return { scenario: "speech_roundtrip", passed: false, details: { stage: "text_to_speech", failure: tts.failure, attempts: tts.attempts, skipped: tts.selection.skipped } };
  }
  const stt = await transcribe(db, { bytes: tts.output.audio, mimeType: tts.output.mimeType, languageHint: "en" }, { includeUntested: true, avoid: [tts.resourceRef ?? ""] }, SPEECH_CTX);
  if (stt.status !== "success" || !stt.output) {
    return { scenario: "speech_roundtrip", passed: false, details: { stage: "speech_to_text", tts: tts.resourceRef, failure: stt.failure, attempts: stt.attempts, skipped: stt.selection.skipped } };
  }
  const wer = wordErrorRate(ROUNDTRIP_TEXT, stt.output.text);
  const passed = wer <= WER_PASS;
  const sameResource = tts.resourceRef === stt.resourceRef;
  const { data: ev } = await db.from("fkaios_verification_evidence").insert({
    requirement_key: "self_test:speech_roundtrip", evidence_type: "deterministic_wer", verifier: "deterministic:word_error_rate",
    status: passed ? "passed" : "failed",
    observed_result: { reference: ROUNDTRIP_TEXT, transcript: stt.output.text, wer, threshold: WER_PASS, tts: tts.resourceRef, stt: stt.resourceRef, same_resource: sameResource,
      audio_bytes: tts.output.audio.length, audio_mime: tts.output.mimeType, language: stt.output.language, tts_attempts: tts.attempts, stt_attempts: stt.attempts },
    verification_notes: `Round trip ${tts.resourceRef} → ${stt.resourceRef}: WER ${wer.toFixed(3)} (pass ≤ ${WER_PASS}).`,
    verified_at: new Date().toISOString(),
  }).select("id").single();
  const evidenceId = ev?.id ?? null;
  await markStepsVerified(db, { stepIds: [...tts.stepIds, ...stt.stepIds] }, passed ? "verified" : "rejected", evidenceId, Math.max(0, 1 - wer));
  if (passed) {
    await promoteOnEvidence(db, "text_to_speech", tts.resourceRef, evidenceId);
    await promoteOnEvidence(db, "speech_to_text", stt.resourceRef, evidenceId);
  }
  return { scenario: "speech_roundtrip", passed, details: { tts: tts.resourceRef, stt: stt.resourceRef, same_resource: sameResource, wer, transcript: stt.output.text, language: stt.output.language, audio_bytes: tts.output.audio.length, evidence_id: evidenceId,
    tts_failovers: tts.attempts.filter((a) => a.outcome === "failed").map((a) => `${a.ref}: ${a.category}`), stt_failovers: stt.attempts.filter((a) => a.outcome === "failed").map((a) => `${a.ref}: ${a.category}`) } };
}

const QUESTION = "What is two plus three? Answer in one short sentence.";

async function voiceTurnScenario(db: Db): Promise<ScenarioResult> {
  const asked = await synthesize(db, QUESTION, null, { includeUntested: true }, SPEECH_CTX);
  if (asked.status !== "success" || !asked.output) return { scenario: "voice_turn", passed: false, details: { stage: "prepare_question_audio", failure: asked.failure } };
  const respond = async (text: string) => {
    const sel = await selectResources(db, "general");
    const started = new Date();
    const r = await callLLMOnResources({ systemPrompt: "You are FKAIOS answering a spoken question. Reply in one short plain sentence suitable for speech.", userContent: text, functionName: "self-test", functionClass: "background_agent", temperature: 0, maxTokens: 80 }, buildDefaultRouterConfig(), sel.resources);
    await recordLLMAttempts(db, { stepKind: "evaluation", taskClass: "general" }, r.log, sel, r.content ?? null, started);
    if (r.status !== "success") throw new Error(r.log.failure_reason ?? "responder failed");
    return { text: (r.content ?? "").trim(), meta: { resource: r.resource?.ref ?? null } };
  };
  const turn = await voiceTurn(db, { bytes: asked.output.audio, mimeType: asked.output.mimeType, languageHint: "en" }, respond,
    { stt: { includeUntested: true }, tts: { includeUntested: true }, ctx: SPEECH_CTX, checkReplyAudio: true });
  const heardWer = turn.transcript ? wordErrorRate(QUESTION, turn.transcript) : 1;
  const answered = !!turn.reply && /\b(five|5)\b/i.test(turn.reply.text);
  const replyAudioOk = !!turn.replyCheck && turn.replyCheck.wer <= 0.3;
  const passed = turn.status === "completed" && heardWer <= 0.25 && answered && replyAudioOk;
  return { scenario: "voice_turn", passed, details: { stage: turn.stage, error: turn.error, transcript: turn.transcript, heard_wer: heardWer, reply: turn.reply?.text ?? null, responder: turn.reply?.meta?.resource ?? null,
    answered_correctly: answered, reply_audio_wer: turn.replyCheck?.wer ?? null, resources: turn.resources, reply_transcribed_by: turn.replyCheck?.transcribedBy ?? null, steps: turn.stepIds.length } };
}

async function structuredRouting(db: Db): Promise<ScenarioResult> {
  const schema = { name: "emit_check", description: "Emit the arithmetic check", input_schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "integer" } }, required: ["question", "answer"] } } }, required: ["items"] } };
  const r = await routedStructuredCall(db, { engine: "fkaios-self-test", taskClass: "reasoning", toolSchema: schema, maxTokens: 400,
    system: "You check arithmetic. Emit exactly two items via emit_check.", user: "Items: 'What is 17 + 25?' and 'What is 9 x 8?'" });
  const items = Array.isArray(r.input?.items) ? r.input!.items as Array<{ answer?: unknown }> : [];
  const answers = items.map((i) => Number(i.answer));
  const correct = answers.includes(42) && answers.includes(72);
  return { scenario: "structured_routing", passed: r.ok && correct && !String(r.resourceRef ?? "").startsWith("model:anthropic:"),
    details: { served_by: r.resourceRef, attempts: r.attempts, answers, failure: r.failure, schema_valid: r.ok } };
}

export async function runSelfTestIfRequested(db: Db): Promise<Record<string, unknown> | null> {
  const { data: req } = await db.from("fkaios_self_tests").select("id").eq("status", "requested").order("requested_at").limit(1).maybeSingle();
  if (!req) return null;
  const { data: claimed } = await db.from("fkaios_self_tests").update({ status: "running", started_at: new Date().toISOString() }).eq("id", req.id).eq("status", "requested").select("id").maybeSingle();
  if (!claimed) return null; // another tick took it
  const results: ScenarioResult[] = [];
  for (const run of [modelFailover, continuation, (db: Db) => verifier(db, false), (db: Db) => verifier(db, true), structuredRouting, speechRoundtrip, voiceTurnScenario]) {
    try { results.push(await run(db)); } catch (err) { results.push({ scenario: run.name || "scenario", passed: false, details: { error: err instanceof Error ? err.message : String(err) } }); }
    await db.from("fkaios_self_tests").update({ results }).eq("id", req.id);
  }
  const passed = results.every((r) => r.passed);
  await db.from("fkaios_self_tests").update({ status: passed ? "passed" : "failed", results, finished_at: new Date().toISOString() }).eq("id", req.id);
  return { self_test: req.id, passed, results: results.map((r) => ({ scenario: r.scenario, passed: r.passed })) };
}
