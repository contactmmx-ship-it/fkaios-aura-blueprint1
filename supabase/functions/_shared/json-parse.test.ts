/// <reference lib="deno.ns" />
import { parseJSONCandidate } from "./json-parse.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("repairs trailing commas in JSON objects and arrays", () => {
  const parsed = parseJSONCandidate('{"name":"Kids DPS","items":[1,2,],}') as { name: string; items: number[] };
  assert(parsed.name === "Kids DPS", "object fields must survive");
  assert(parsed.items.length === 2 && parsed.items[1] === 2, "array values must survive");
});

Deno.test("does not alter comma-brace text inside JSON strings", () => {
  const parsed = parseJSONCandidate('{"text":"literal , } and , ] inside string","value":1,}') as { text: string; value: number };
  assert(parsed.text === "literal , } and , ] inside string", "string contents must remain exact");
  assert(parsed.value === 1, "ordinary fields must survive");
});

Deno.test("still rejects malformed JSON unrelated to trailing commas", () => {
  let rejected = false;
  try { parseJSONCandidate('{"name":Kids DPS}'); } catch { rejected = true; }
  assert(rejected, "parser must not guess unquoted string values");
});

Deno.test("repairs unquoted object keys but not bare values", () => {
  const parsed = parseJSONCandidate('{name: "Kids DPS", items:[1,2,],}') as { name: string; items: number[] };
  assert(parsed.name === "Kids DPS", "unquoted object key must be normalized");
  assert(parsed.items.length === 2, "trailing array comma must be normalized");
});
