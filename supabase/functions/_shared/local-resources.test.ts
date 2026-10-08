/// <reference lib="deno.ns" />
import { parseSelfHostedModels } from "./capability-discovery.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n     got ${a}`);
}

Deno.test("local OpenAI-compatible server: chat models are registered as free, zero-API-cost resources", () => {
  const body = { data: [{ id: "qwen2.5:14b" }, { id: "llama3.1:8b" }, { id: "nomic-embed-text" }, { id: "whisper-small" }] };
  assertEquals(parseSelfHostedModels(body).map((m) => [m.provider, m.model, m.freeTier, m.costInPerMtok]), [["self_hosted", "qwen2.5:14b", true, 0], ["self_hosted", "llama3.1:8b", true, 0]]);
});
