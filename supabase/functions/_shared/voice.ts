// VOICE TURN — the voice modality around any FKAIOS responder:
//   audio ─► speech_to_text ─► respond(text) ─► text_to_speech ─► audio
// The responder is passed in, so the same brain serves text, voice, web, API
// and agents; nothing here holds business logic. Each leg is selected and
// recorded by the speech capability layer, and the reply audio can be checked
// by transcribing it back (checkReplyAudio).

import { synthesize, transcribe, wordErrorRate, type AudioInput, type SpeechContext, type SpeechSelectionOptions } from "./speech.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface VoiceReply { text: string; meta?: Record<string, unknown> }

export interface VoiceTurnResult {
  status: "completed" | "failed";
  stage: "speech_to_text" | "respond" | "text_to_speech" | "done";
  transcript: string | null;
  language: string | null;
  reply: VoiceReply | null;
  audio: { bytes: Uint8Array; mimeType: string } | null;
  resources: { speech_to_text: string | null; text_to_speech: string | null };
  stepIds: string[];
  replyCheck: { wer: number; transcribedBy: string | null } | null;
  error: string | null;
}

export interface VoiceTurnOptions {
  stt?: SpeechSelectionOptions;
  tts?: SpeechSelectionOptions;
  voice?: string | null;
  ctx?: SpeechContext;
  /** Transcribe the reply audio back and measure WER against the reply text (costs one more STT call). */
  checkReplyAudio?: boolean;
}

export async function voiceTurn(db: Db, audio: AudioInput, respond: (text: string, language: string | null) => Promise<VoiceReply>, opts: VoiceTurnOptions = {}): Promise<VoiceTurnResult> {
  const ctx = opts.ctx ?? { stepKind: "task_execution" };
  const base: VoiceTurnResult = { status: "failed", stage: "speech_to_text", transcript: null, language: null, reply: null, audio: null, resources: { speech_to_text: null, text_to_speech: null }, stepIds: [], replyCheck: null, error: null };

  const heard = await transcribe(db, audio, opts.stt ?? {}, ctx);
  base.stepIds.push(...heard.stepIds);
  if (heard.status !== "success" || !heard.output) return { ...base, error: heard.failure };
  base.transcript = heard.output.text;
  base.language = heard.output.language;
  base.resources.speech_to_text = heard.resourceRef;

  let reply: VoiceReply;
  try {
    reply = await respond(heard.output.text, heard.output.language);
  } catch (err) {
    return { ...base, stage: "respond", error: err instanceof Error ? err.message : String(err) };
  }
  if (!reply.text.trim()) return { ...base, stage: "respond", error: "responder returned no text" };
  base.reply = reply;

  const spoken = await synthesize(db, reply.text, opts.voice ?? null, opts.tts ?? {}, ctx);
  base.stepIds.push(...spoken.stepIds);
  if (spoken.status !== "success" || !spoken.output) return { ...base, stage: "text_to_speech", error: spoken.failure };
  base.audio = { bytes: spoken.output.audio, mimeType: spoken.output.mimeType };
  base.resources.text_to_speech = spoken.resourceRef;

  if (opts.checkReplyAudio) {
    const back = await transcribe(db, { bytes: spoken.output.audio, mimeType: spoken.output.mimeType, languageHint: heard.output.language ?? undefined },
      { ...(opts.stt ?? {}), avoid: [...(opts.stt?.avoid ?? []), spoken.resourceRef ?? ""] }, ctx);
    base.stepIds.push(...back.stepIds);
    base.replyCheck = back.status === "success" && back.output
      ? { wer: wordErrorRate(reply.text, back.output.text), transcribedBy: back.resourceRef }
      : { wer: 1, transcribedBy: null };
  }
  return { ...base, status: "completed", stage: "done" };
}
