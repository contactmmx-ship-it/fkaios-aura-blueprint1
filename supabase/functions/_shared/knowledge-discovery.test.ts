import { assert, assertEquals } from "jsr:@std/assert@1";
import { extractPdfPages, inferPrintedLabels, printedNumberOnPage, sha256Hex, singlePagePdf } from "./knowledge-library.ts";
import { buildFooterBook, buildLabelledBook } from "./knowledge-self-test.ts";
import { clip, localDateHour, parseGithubSearch, parseHuggingFace, parseMcpRegistry, parseOpenRouterFree, scoreRelevance, sourceSpecs } from "./ecosystem-discovery.ts";

Deno.test("PDF /PageLabels give printed labels distinct from PDF indices", async () => {
  const pages = await extractPdfPages(await buildLabelledBook("t1"));
  assertEquals(pages.map((p) => p.printedLabel), ["i", "ii", "1", "2", "3", "4"]);
  assertEquals(pages[3].pdfPage, 4);
  assertEquals(pages[3].labelBasis, "pdf_page_labels");
  assert(pages[3].text.includes("lblt1p4"));
  assert(pages.every((p) => !p.needsOcr));
});

Deno.test("footer numbers map printed page 18 to PDF page 20; a missing footer is inferred; a scan needs OCR", async () => {
  const pages = await extractPdfPages(await buildFooterBook("t2"));
  assertEquals(pages.length, 22);
  assertEquals(pages[0].printedLabel, null);
  assertEquals(pages[19].printedLabel, "18");
  assertEquals(pages[19].labelBasis, "printed_on_page");
  assertEquals(pages[9].printedLabel, "8");
  assertEquals(pages[9].labelBasis, "inferred_offset");
  assert(pages[21].needsOcr);
  assert(!pages[19].needsOcr);
});

Deno.test("a single page can be cut out for OCR", async () => {
  const one = await singlePagePdf(await buildFooterBook("t3"), 22);
  const pages = await extractPdfPages(one);
  assertEquals(pages.length, 1);
  assert(pages[0].needsOcr);
});

Deno.test("printed number detection and offset inference", () => {
  assertEquals(printedNumberOnPage(["Chapter one", "body", "17"]), 17);
  assertEquals(printedNumberOnPage(["Page 4", "body"]), 4);
  assertEquals(printedNumberOnPage(["12 | The Franchise Book", "body"]), 12);
  assertEquals(printedNumberOnPage(["body mentions page 9 in passing"]), null);
  // Too few numbered pages: nothing is inferred.
  assertEquals(inferPrintedLabels([null, 1, null]).map((x) => x.label), [null, "1", null]);
  // A stray number that disagrees with the majority offset is not trusted as a label.
  const labels = inferPrintedLabels([null, null, 1, 2, 99, 4, 5]);
  assertEquals(labels[4], { label: "3", basis: "inferred_offset" });
});

Deno.test("sha256 is stable", async () => {
  assertEquals(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("MCP registry entries are classified by risk and deleted/old versions skipped", () => {
  const body = { servers: [
    { server: { name: "io.example/remote", description: "Hosted OCR for PDF documents", version: "1.0.0", remotes: [{ type: "streamable-http", url: "https://x.example/mcp" }] }, _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } } },
    { server: { name: "io.example/pkg", description: "npm package", packages: [{ registryType: "npm", environmentVariables: [{ name: "FOO_API_KEY", isSecret: true }] }] }, _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } } },
    { server: { name: "io.example/old" }, _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: false } } },
    { server: { name: "io.example/gone" }, _meta: { "io.modelcontextprotocol.registry/official": { status: "deleted" } } },
  ] };
  const c = parseMcpRegistry(body);
  assertEquals(c.map((x) => x.canonicalKey), ["mcp:io.example/remote", "mcp:io.example/pkg"]);
  assertEquals(c[0].riskClass, "remote_service");
  assertEquals(c[1].riskClass, "requires_credentials");
});

Deno.test("GitHub, Hugging Face and OpenRouter parsers", () => {
  const gh = parseGithubSearch({ items: [{ full_name: "Org/Repo", html_url: "https://github.com/Org/Repo", description: "Supabase MCP server", stargazers_count: 1500, license: { spdx_id: "MIT" } }, { full_name: "x/fork", fork: true }] });
  assertEquals(gh.length, 1);
  assertEquals(gh[0].canonicalKey, "github:org/repo");
  assertEquals(gh[0].license, "MIT");
  const hf = parseHuggingFace([{ id: "org/whisper-hindi", pipeline_tag: "automatic-speech-recognition", tags: ["hindi", "license:apache-2.0"], likes: 10 }]);
  assertEquals(hf[0].license, "apache-2.0");
  const or = parseOpenRouterFree({ data: [{ id: "a/free:free", pricing: { prompt: "0", completion: "0" } }, { id: "b/paid", pricing: { prompt: "0.000001", completion: "0.000002" } }] });
  assertEquals(or.map((x) => x.name), ["a/free:free"]);
  assertEquals(or[0].kind, "free_model");
});

Deno.test("relevance follows project needs; popularity only breaks ties", () => {
  const ocr = scoreRelevance({ canonicalKey: "k", source: "github", kind: "repository", name: "pdf-ocr", description: "OCR for scanned PDF pages with Hindi support", version: null, license: "MIT", metrics: { stars: 10 }, riskClass: "executable_code" });
  const popular = scoreRelevance({ canonicalKey: "k2", source: "github", kind: "repository", name: "chat-ui", description: "A chat interface", version: null, license: null, metrics: { stars: 90000 }, riskClass: "executable_code" });
  assert(ocr.score > popular.score);
  assert(ocr.reasons.some((r) => r.startsWith("document ocr → ") && r.includes("eBill2Tally")));
  assert(ocr.reasons.some((r) => r.startsWith("indian languages → ")));
  assertEquals(popular.score, 0); // stars alone never make a find relevant
  assertEquals(popular.reasons, ["no current project need"]);
});

Deno.test("keyword noise no longer outranks real needs (29 Oct 2026: TikTok downloader scored like OCR)", () => {
  const downloader = scoreRelevance({ canonicalKey: "d", source: "github", kind: "repository", name: "Evil0ctal/Douyin_TikTok_Download_API",
    description: "Self-hosted TikTok, Douyin & Bilibili scraper and no-watermark video downloader — AI agent via MCP, offline speech-to-text", version: null, license: "Apache-2.0", metrics: { stars: 20807 }, riskClass: "executable_code" });
  const ocr = scoreRelevance({ canonicalKey: "o", source: "huggingface", kind: "model", name: "baidu/Unlimited-OCR", description: "image-text-to-text, ocr, multilingual", version: null, license: "mit", metrics: { likes: 4637 }, riskClass: "executable_code" });
  assert(downloader.score < 0, `downloader scored ${downloader.score}`);
  assert(downloader.reasons.includes("penalty: media downloader"));
  assert(ocr.score >= 6, `OCR model scored ${ocr.score}`);
});

Deno.test("free API models count as quota-fallback capacity; image generation is not a need", () => {
  const free = scoreRelevance({ canonicalKey: "f", source: "openrouter", kind: "free_model", name: "x/small:free", description: "A small chat model", version: null, license: null, metrics: {}, riskClass: "requires_credentials" });
  assert(free.score >= 3 && free.reasons.some((r) => r.startsWith("free llm capacity → ")));
  const img = scoreRelevance({ canonicalKey: "i", source: "huggingface", kind: "model", name: "a/flux-thing", description: "text-to-image, diffusers", version: null, license: "apache-2.0", metrics: { likes: 9000 }, riskClass: "executable_code" });
  assert(img.score <= 0, `image model scored ${img.score}`);
});

Deno.test("untrusted descriptions are clipped and control characters removed", () => {
  assertEquals(clip("a\u0000b\nc"), "a b c");
  assertEquals(clip("x".repeat(500))!.length, 400);
  assertEquals(clip(42), null);
});

Deno.test("schedule date and hour are computed in Asia/Kolkata", () => {
  assertEquals(localDateHour(new Date("2026-10-09T00:29:00Z")), { date: "2026-10-09", hour: 5 });
  assertEquals(localDateHour(new Date("2026-10-08T19:00:00Z")), { date: "2026-10-09", hour: 0 });
  assertEquals(localDateHour(new Date("2026-10-09T00:31:00Z")).hour, 6);
});

Deno.test("GitHub token is optional and only sent when configured", () => {
  const without = sourceSpecs(new Date("2026-10-09T00:00:00Z"), () => undefined);
  assert(without.every((s) => !s.headers?.Authorization));
  const withTok = sourceSpecs(new Date("2026-10-09T00:00:00Z"), (k) => k === "GITHUB_TOKEN" ? "t" : undefined);
  assert(withTok.some((s) => s.headers?.Authorization === "Bearer t"));
  assert(without.every((s) => !s.url.includes("token")));
});

import { unsupportedFigures, verifyAdaptation } from "./blueprint-reuse.ts";

Deno.test("blueprint checks: figures must be recorded facts or marked to verify", () => {
  assertEquals(unsupportedFigures("Investment 10L - 30L, royalty 8%. Step 3 of 5.", ["10L - 30L", "8%"]), []);
  assertEquals(unsupportedFigures("Expect 45 outlets by 2027 [TO VERIFY: 2028 target]", ["10L - 30L"]), ["45", "2027"]);
});

Deno.test("blueprint checks: leakage, coverage and recorded facts", () => {
  const source = { ref: "client_projects:x", title: "t", text: "Mr. Chick'n for Five Star", brand: "Mr. Chick'n", counterparty: "Five Star Chicken India" };
  const target = { name: "Chaat Masters", sector: "QSR", type: "franchise", investment_range: "10L - 30L", royalty: "8%", description: null };
  const good = verifyAdaptation(source, ["Scope", "Deliverables"], target, { title: "Chaat Masters partnership", sections: [
    { heading: "Scope", inherited_from: "Scope", text: "Chaat Masters will engage [PROSPECT]. Investment 10L - 30L, royalty 8%.", changed: [] },
    { heading: "Deliverables", inherited_from: "Deliverables", text: "Qualification call.", changed: [] }] });
  assert(Object.values(good).every((c) => c.ok), JSON.stringify(good));
  const bad = verifyAdaptation(source, ["Scope", "Deliverables"], target, { title: "Mr. Chick'n copy", sections: [
    { heading: "Scope", inherited_from: "Scope", text: "Engage Five Star Chicken India for 120 outlets.", changed: [] }] });
  assertEquals(bad.no_source_names.ok, false);
  assertEquals(bad.sections_carried_over.ok, false);
  assertEquals(bad.no_unsupported_figures.ok, false);
  assertEquals(bad.target_named.ok, false);
});
