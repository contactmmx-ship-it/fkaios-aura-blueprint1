import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkDocument, sha256Hex, splitPages } from "./vault-document.ts";

Deno.test("checkDocument rejects empty or oversized input", () => {
  assertEquals(checkDocument("", "x"), "Title is required.");
  assertEquals(checkDocument("T", "  "), "Content is required.");
  assert(checkDocument("T", "x".repeat(200_001))!.startsWith("Document is too long"));
  assertEquals(checkDocument("Plan", "Some text"), null);
});

Deno.test("splitPages keeps whole lines and line numbers", () => {
  const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1} ` + "a".repeat(40)).join("\n");
  const pages = splitPages(text, 120);
  assert(pages.length >= 4);
  assertEquals(pages[0].line_start, 1);
  assertEquals(pages[pages.length - 1].line_end, 10);
  for (const p of pages) assert(p.text.length <= 120);
  assertEquals(pages.map((p) => p.text).join("\n"), text);
});

Deno.test("splitPages cuts a very long single line", () => {
  const pages = splitPages("b".repeat(250), 100);
  assertEquals(pages.map((p) => p.text.length), [100, 100, 50]);
});

Deno.test("sha256Hex is stable", async () => {
  assertEquals(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
