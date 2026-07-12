// verify-voice v3 — one-shot ElevenLabs voice-ID verification utility.
// v3 (P1.5 parity, 2026-07-12): verify_jwt is now TRUE. The previous version
// was publicly reachable and burned real ElevenLabs credits on every
// anonymous hit. Capability preserved for authenticated callers.
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const CANDIDATE = "cd8f613c6a6f0df6bb7b235f933541454a7bec5faf967149ebf10c48f1ef5775";
const KNOWN_GOOD_DEFAULT = "21m00Tcm4TlvDq8ikWAM";

Deno.serve(async (req: Request) => {
  const results: Record<string, unknown> = {};
  for (const [label, voiceId] of [["candidate", CANDIDATE], ["known_good_default", KNOWN_GOOD_DEFAULT]] as const) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "ok", model_id: "eleven_multilingual_v2" }),
      });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        results[label] = { status: r.status, audio_bytes_received: buf.byteLength };
      } else {
        results[label] = { status: r.status, body: (await r.text()).slice(0, 400) };
      }
    } catch (err) {
      results[label] = { error: String(err) };
    }
  }
  return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
});
