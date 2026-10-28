// 28 Oct 2026: Groq models are discovered so the router can move to another free Groq model when one hits its limit.
import { parseGroqModels } from "./capability-discovery.ts";
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

Deno.test("groq discovery keeps active text models as free capacity, drops speech/guard/inactive", () => {
  const body = { data: [
    { id: "llama-3.3-70b-versatile", active: true, context_window: 131072, max_completion_tokens: 32768 },
    { id: "openai/gpt-oss-20b", active: true, context_window: 131072 },
    { id: "whisper-large-v3", active: true },
    { id: "meta-llama/llama-guard-4-12b", active: true },
    { id: "playai-tts", active: true },
    { id: "old-model", active: false },
  ] };
  const models = parseGroqModels(body);
  const ids = models.map((m) => m.model);
  assert(ids.length === 2 && ids.includes("llama-3.3-70b-versatile") && ids.includes("openai/gpt-oss-20b"), JSON.stringify(ids));
  assert(models.every((m) => m.provider === "groq" && m.freeTier === true && m.costInPerMtok === 0), "free, zero cost");
  assert(parseGroqModels({}).length === 0, "empty body");
});
