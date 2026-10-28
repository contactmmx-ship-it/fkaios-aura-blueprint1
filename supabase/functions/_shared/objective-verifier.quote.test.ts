import { quoteFoundInOrder } from "./objective-verifier.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const hay = "1. franchise pitch deck creation (2025-12-15) chatgpt: franchise pitch deck creation. 2. tiers: master arena 800–1200 sq ft costs ₹50–70 l";
Deno.test("verbatim quote passes", () => assert(quoteFoundInOrder(hay, "master arena 800–1200 sq ft"), "verbatim"));
Deno.test("ellipsis-joined real excerpts in order pass", () => assert(quoteFoundInOrder(hay, "franchise pitch deck creation (2025-12-15) ... master arena 800–1200 sq ft"), "in order"));
Deno.test("excerpts out of order fail", () => assert(!quoteFoundInOrder(hay, "master arena 800–1200 sq ft ... franchise pitch deck creation (2025-12-15)"), "order"));
Deno.test("paraphrase fails", () => assert(!quoteFoundInOrder(hay, "the flagship outlet needs fifty lakh"), "paraphrase"));
Deno.test("tiny fragments fail", () => assert(!quoteFoundInOrder(hay, "tiers ... sq"), "tiny"));
