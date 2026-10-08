// SPEECH EVALUATION — discovery is not trust. A speech resource found by
// discovery is used in production only after a controlled round trip proves
// it: the candidate does one leg, the current tested resource of the other
// capability does the other, and the transcript is scored against the known
// text by code (word error rate). The result is compared with the incumbent
// (the resource production ranks first today) and recorded as evidence; only a
// pass promotes the candidate to 'verified'. One candidate per run, free and
// local resources only (testing a paid resource is a spend decision).

import { credentialPresent, rankSpeechResources, synthesize, transcribe, wordErrorRate, type SpeechResourceRow } from "./speech.ts";
import { markStepsVerified } from "./execution-evidence.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const SPEECH_SUITE = "eval:speech_roundtrip_v1";
export const SPEECH_SENTENCES = [
  "Franchise Kart helps entrepreneurs open new franchise outlets across India.",
  "Please schedule the review meeting for Tuesday at eleven in the morning.",
];
export const SPEECH_WER_PASS = 0.2;
const EVAL_INTERVAL_MIN = 30;
const RETEST_AFTER_HOURS = 24;
/** A run that failed on the partner leg says nothing about the candidate: retry soon. */
const PARTNER_RETRY_MIN = 30;

type Env = (k: string) => string | undefined;

/** The next resource to evaluate: untested, configured, not paid, not tried in the last day. */
export function pickSpeechCandidate(rows: SpeechResourceRow[], env: Env, now = new Date()): SpeechResourceRow | null {
  const due = rows.filter((r) => ["discovered", "available"].includes(r.lifecycle_state) && r.tier !== "paid_premium" && credentialPresent(r.credential_ref, env)
    && (() => {
      const meta = (r.metadata as Record<string, unknown> | null) ?? {};
      if (!meta.last_eval_at) return true;
      const waitMs = meta.last_eval_result === "partner_unavailable" ? PARTNER_RETRY_MIN * 60_000 : RETEST_AFTER_HOURS * 3600_000;
      return now.getTime() - new Date(String(meta.last_eval_at)).getTime() > waitMs;
    })());
  const tierOrder = ["local", "self_hosted", "internal", "free_external", "low_cost_external"];
  due.sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier) || a.resource_ref.localeCompare(b.resource_ref));
  return due[0] ?? null;
}

export async function runSpeechEvaluationTick(db: Db, env: Env = (k) => Deno.env.get(k), now = new Date()): Promise<Record<string, unknown>> {
  const { data: last } = await db.from("fkaios_verification_evidence").select("created_at").eq("requirement_key", SPEECH_SUITE).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.created_at && now.getTime() - new Date(last.created_at).getTime() < EVAL_INTERVAL_MIN * 60_000) return { idle: `last speech evaluation at ${last.created_at}` };
  const { data } = await db.from("fkaios_resource_capabilities")
    .select("capability,resource_ref,provider,tier,credential_ref,privacy_class,lifecycle_state,health_status,unavailable_until,consecutive_failures,metadata")
    .in("capability", ["speech_to_text", "text_to_speech"]);
  const rows = (data ?? []) as SpeechResourceRow[];
  const candidate = pickSpeechCandidate(rows, env, now);
  if (!candidate) return { idle: "no untested free or local speech resource is configured" };
  const other = candidate.capability === "text_to_speech" ? "speech_to_text" : "text_to_speech";
  const sameCap = rows.filter((r) => r.capability === candidate.capability);
  const incumbent = rankSpeechResources(sameCap.filter((r) => r.resource_ref !== candidate.resource_ref), {}, env, now).ranked[0]?.row ?? null;
  const forceCandidate = { includeUntested: true, exclude: sameCap.filter((r) => r.resource_ref !== candidate.resource_ref).map((r) => r.resource_ref) };
  // The partner leg prefers tested resources and never the candidate itself.
  const partnerTested = rankSpeechResources(rows.filter((r) => r.capability === other), {}, env, now).ranked.length > 0;
  const partnerOpts = { includeUntested: !partnerTested, avoid: [candidate.resource_ref] };
  const ctx = { stepKind: "evaluation" as const, storeExcerpt: true };

  const results: Array<Record<string, unknown>> = [];
  const stepIds: string[] = [];
  let candidateMs = 0;
  let partnerRef: string | null = null;
  let failure: string | null = null;
  let partnerFailed = false;
  for (const text of SPEECH_SENTENCES) {
    const tts = await synthesize(db, text, null, candidate.capability === "text_to_speech" ? forceCandidate : partnerOpts, ctx, env);
    stepIds.push(...tts.stepIds);
    if (tts.status !== "success" || !tts.output) { failure = `text_to_speech: ${tts.failure}`; partnerFailed = candidate.capability !== "text_to_speech"; break; }
    const stt = await transcribe(db, { bytes: tts.output.audio, mimeType: tts.output.mimeType, languageHint: "en" }, candidate.capability === "speech_to_text" ? forceCandidate : partnerOpts, ctx, env);
    stepIds.push(...stt.stepIds);
    if (stt.status !== "success" || !stt.output) { failure = `speech_to_text: ${stt.failure}`; partnerFailed = candidate.capability !== "speech_to_text"; break; }
    const candLeg = candidate.capability === "text_to_speech" ? tts : stt;
    if (candLeg.resourceRef !== candidate.resource_ref) { failure = `candidate leg was served by ${candLeg.resourceRef}`; break; }
    candidateMs += candLeg.attempts.at(-1)?.durationMs ?? 0;
    partnerRef = candidate.capability === "text_to_speech" ? stt.resourceRef : tts.resourceRef;
    results.push({ reference: text, transcript: stt.output.text, wer: wordErrorRate(text, stt.output.text) });
  }
  const meanWer = results.length === SPEECH_SENTENCES.length ? results.reduce((a, r) => a + Number(r.wer), 0) / results.length : 1;
  const passed = !failure && meanWer <= SPEECH_WER_PASS;
  const incumbentMeta = (incumbent?.metadata ?? {}) as Record<string, unknown>;
  const comparison = incumbent
    ? { incumbent: incumbent.resource_ref, incumbent_wer: incumbentMeta.last_wer ?? null, incumbent_latency_ms: incumbentMeta.last_latency_ms ?? null,
        better_or_equal_quality: incumbentMeta.last_wer == null ? null : meanWer <= Number(incumbentMeta.last_wer) + 0.02 }
    : { incumbent: null, note: "no tested incumbent: this resource would become the first" };
  const { data: ev } = await db.from("fkaios_verification_evidence").insert({
    requirement_key: SPEECH_SUITE, evidence_type: "golden_eval", verifier: "deterministic:word_error_rate", status: passed ? "passed" : "failed",
    observed_result: { candidate: candidate.resource_ref, capability: candidate.capability, partner: partnerRef, mean_wer: meanWer, threshold: SPEECH_WER_PASS, mean_candidate_latency_ms: results.length ? Math.round(candidateMs / results.length) : null, results, failure, comparison },
    verification_notes: failure ? `Not evaluated to completion: ${failure}` : `${candidate.resource_ref} (${candidate.capability}) mean WER ${meanWer.toFixed(3)} with partner ${partnerRef}.`,
    verified_at: new Date().toISOString(),
  }).select("id").single();
  const evidenceId = ev?.id ?? null;
  await markStepsVerified(db, { stepIds }, passed ? "verified" : "rejected", evidenceId, Math.max(0, 1 - meanWer));
  const meta = { ...((candidate.metadata ?? {}) as Record<string, unknown>), last_eval_at: now.toISOString(), last_wer: failure ? null : meanWer, last_latency_ms: results.length ? Math.round(candidateMs / results.length) : null, last_eval_evidence: evidenceId, last_eval_result: passed ? "passed" : partnerFailed ? "partner_unavailable" : failure ? "error" : "failed" };
  await db.from("fkaios_resource_capabilities").update({ metadata: meta, ...(passed ? { lifecycle_state: "verified", evidence_id: evidenceId } : {}), updated_at: new Date().toISOString() })
    .eq("capability", candidate.capability).eq("resource_ref", candidate.resource_ref);
  return { candidate: candidate.resource_ref, capability: candidate.capability, passed, mean_wer: meanWer, failure, partner_failed: partnerFailed, comparison, evidence: evidenceId };
}
