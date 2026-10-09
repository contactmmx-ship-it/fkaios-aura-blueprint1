// KNOWLEDGE LIBRARY — page-exact ingestion and retrieval.
//
// A request such as "page 18 of the franchise book" must return that page, not
// a semantically similar passage. Every PDF page is stored with BOTH its PDF
// index and its printed page label, and with how the label was established:
//   pdf_page_labels  — the PDF's own /PageLabels (front matter i, ii, … then 1, 2, …)
//   printed_on_page  — a page number printed in the page's header/footer text
//   inferred_offset  — derived from the consistent offset of neighbouring printed numbers
// Text comes from the PDF text layer; a page without one (a scan) is flagged
// needs_ocr and, when OCR is requested, transcribed by a vision-capable model,
// marked ocr_derived. Retrieval reports completeness so the founder can tell an
// exact page from an OCR reading. Sources are deduplicated by SHA-256.

import { getDocumentProxy } from "npm:unpdf@0.12.1";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { bytesToBase64 } from "./speech.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
type Env = (k: string) => string | undefined;

export type SourceKind = "book" | "sop" | "proposal" | "conversation" | "document" | "test_fixture";
export type CopyrightClass = "owned" | "licensed" | "public_domain" | "third_party_copyrighted" | "unknown";

export interface SourceMeta {
  title: string;
  author?: string | null;
  edition?: string | null;
  isbn?: string | null;
  sourceKind: SourceKind;
  filename?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  provenance?: string | null;
  copyrightClass?: CopyrightClass;
  brand?: string | null;
  projectRef?: string | null;
  createdBy?: string | null;
}

export interface ExtractedPage {
  pdfPage: number;
  text: string;
  printedLabel: string | null;
  labelBasis: "pdf_page_labels" | "printed_on_page" | "inferred_offset" | null;
  needsOcr: boolean;
}

/** A page with fewer characters than this has no usable text layer. */
export const MIN_TEXT_CHARS = 25;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The number printed in a page's header or footer, if any (first or last short line). */
export function printedNumberOnPage(lines: string[]): number | null {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  const candidates = [cleaned[0], cleaned[cleaned.length - 1]];
  for (const line of candidates) {
    const m = line.match(/^(?:page\s+)?(\d{1,4})$/i) ?? line.match(/^(\d{1,4})\s*[|·•–-]\s*\S.{0,60}$/) ?? line.match(/^\S.{0,60}\s*[|·•–-]\s*(\d{1,4})$/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Printed page labels for pages without /PageLabels: the numbers printed on
 * the pages themselves, and, where a page carries none, the offset that most
 * printed numbers agree on (only when at least 3 pages and a majority agree).
 */
export function inferPrintedLabels(printed: Array<number | null>): Array<{ label: string | null; basis: "printed_on_page" | "inferred_offset" | null }> {
  const offsets = new Map<number, number>();
  printed.forEach((n, i) => { if (n != null) offsets.set(n - (i + 1), (offsets.get(n - (i + 1)) ?? 0) + 1); });
  const numbered = printed.filter((n) => n != null).length;
  let best: { offset: number; votes: number } | null = null;
  for (const [offset, votes] of offsets) if (!best || votes > best.votes) best = { offset, votes };
  const trusted = best && best.votes >= 3 && best.votes * 2 > numbered ? best.offset : null;
  return printed.map((n, i) => {
    if (n != null && (trusted == null || n - (i + 1) === trusted)) return { label: String(n), basis: "printed_on_page" as const };
    if (trusted != null && i + 1 + trusted >= 1) return { label: String(i + 1 + trusted), basis: "inferred_offset" as const };
    return { label: null, basis: null };
  });
}

/** Per-page text and printed labels from a PDF. */
export async function extractPdfPages(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const labels = await pdf.getPageLabels().catch(() => null) as string[] | null;
  const texts: string[] = [];
  const lineSets: string[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from the text items' vertical positions so headers/footers stay separate lines.
    const rows = new Map<number, Array<{ x: number; s: string }>>();
    // deno-lint-ignore no-explicit-any
    for (const item of content.items as any[]) {
      if (typeof item.str !== "string") continue;
      const y = Math.round(Number(item.transform?.[5] ?? 0));
      const x = Number(item.transform?.[4] ?? 0);
      const row = rows.get(y) ?? [];
      row.push({ x, s: item.str });
      rows.set(y, row);
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
    lineSets.push(lines);
    texts.push(lines.join("\n"));
  }
  const usePdfLabels = Array.isArray(labels) && labels.length === pdf.numPages && labels.some((l, i) => l !== String(i + 1));
  const inferred = usePdfLabels ? [] : inferPrintedLabels(lineSets.map(printedNumberOnPage));
  return texts.map((text, i) => ({
    pdfPage: i + 1,
    text,
    printedLabel: usePdfLabels ? labels![i] : inferred[i].label,
    labelBasis: usePdfLabels ? "pdf_page_labels" : inferred[i].basis,
    needsOcr: text.replace(/\s/g, "").length < MIN_TEXT_CHARS,
  }));
}

/** One page of a PDF as its own PDF (for OCR of a scanned page). */
export async function singlePagePdf(bytes: Uint8Array, pdfPage: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [pdfPage - 1]);
  out.addPage(page);
  return await out.save();
}

const OCR_PROMPT = "This is one scanned page. Transcribe ALL text on it exactly as printed, top to bottom, keeping headings, list items and table rows on separate lines. Do not summarise, translate or add anything. If there is no legible text, respond with an empty string.";

/**
 * OCR one page with the vision-capable models production routing currently
 * trusts (adopted, monitored, verified — in that order), failing over between
 * them. Returns the text and the resource that read it.
 */
export async function ocrPage(db: Db, pagePdf: Uint8Array, env: Env = (k) => Deno.env.get(k)): Promise<{ text: string; resource: string } | { error: string }> {
  const key = env("GEMINI_API_KEY");
  if (!key) return { error: "no OCR-capable resource is configured (GEMINI_API_KEY unset)" };
  const { data } = await db.from("model_registry").select("model,lifecycle_state").eq("provider", "gemini").in("lifecycle_state", ["adopted", "monitored", "verified"]);
  const order = ["adopted", "monitored", "verified"];
  const models = ((data ?? []) as Array<{ model: string; lifecycle_state: string }>)
    .sort((a, b) => order.indexOf(a.lifecycle_state) - order.indexOf(b.lifecycle_state) || a.model.localeCompare(b.model)).map((m) => m.model);
  const errors: string[] = [];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: bytesToBase64(pagePdf) } }, { text: OCR_PROMPT }] }], generationConfig: { temperature: 0 } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) { errors.push(`${model}: HTTP ${res.status}`); await res.body?.cancel(); continue; }
      const body = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      return { text, resource: `model:gemini:${model}` };
    } catch (e) {
      errors.push(`${model}: ${String(e).slice(0, 120)}`);
    }
  }
  return { error: errors.length ? `all OCR resources failed: ${errors.join("; ")}` : "no adopted or verified Gemini model available for OCR" };
}

export interface IngestResult { sourceId: string; duplicate: boolean; pages: number; needsOcr: number; ocrDone: number; status: string; report: Record<string, unknown> }

async function existingSource(db: Db, sha: string): Promise<{ id: string; page_count: number; ingestion_status: string } | null> {
  const { data } = await db.from("fkaios_knowledge_sources").select("id,page_count,ingestion_status").eq("sha256", sha).maybeSingle();
  return data ?? null;
}

function sourceRow(meta: SourceMeta, sha: string, mime: string) {
  return {
    title: meta.title, author: meta.author ?? null, edition: meta.edition ?? null, isbn: meta.isbn ?? null, source_kind: meta.sourceKind,
    filename: meta.filename ?? null, storage_bucket: meta.storageBucket ?? null, storage_path: meta.storagePath ?? null, provenance: meta.provenance ?? null,
    sha256: sha, mime_type: mime, copyright_class: meta.copyrightClass ?? "unknown", brand: meta.brand ?? null, project_ref: meta.projectRef ?? null, created_by: meta.createdBy ?? null,
  };
}

/** Ingest a PDF page by page. Re-ingesting identical bytes returns the existing source. */
export async function ingestPdf(db: Db, bytes: Uint8Array, meta: SourceMeta, opts: { ocr?: boolean; maxOcrPages?: number } = {}, env: Env = (k) => Deno.env.get(k)): Promise<IngestResult> {
  const sha = await sha256Hex(bytes);
  const existing = await existingSource(db, sha);
  if (existing) return { sourceId: existing.id, duplicate: true, pages: existing.page_count, needsOcr: 0, ocrDone: 0, status: existing.ingestion_status, report: {} };
  const { data: src, error } = await db.from("fkaios_knowledge_sources").insert(sourceRow(meta, sha, "application/pdf")).select("id").single();
  if (error || !src) throw new Error(`could not create knowledge source: ${error?.message ?? "no row"}`);
  try {
    const pages = await extractPdfPages(bytes);
    let ocrDone = 0;
    const ocrErrors: string[] = [];
    const rows: Array<Record<string, unknown>> = [];
    for (const p of pages) {
      let text = p.text, extraction = p.needsOcr ? "none" : "text_layer", completeness = p.needsOcr ? "partial" : "complete", ocrResource: string | null = null, needsOcr = p.needsOcr;
      if (p.needsOcr && opts.ocr && ocrDone < (opts.maxOcrPages ?? 25)) {
        const r = await ocrPage(db, await singlePagePdf(bytes, p.pdfPage), env);
        if ("text" in r) { text = r.text; extraction = "ocr"; completeness = r.text ? "ocr_derived" : "uncertain"; ocrResource = r.resource; needsOcr = false; ocrDone++; }
        else ocrErrors.push(`page ${p.pdfPage}: ${r.error}`);
      }
      rows.push({ source_id: src.id, pdf_page: p.pdfPage, printed_label: p.printedLabel, label_basis: p.labelBasis, text, char_count: text.length, extraction, ocr_resource: ocrResource, needs_ocr: needsOcr, completeness });
    }
    for (let i = 0; i < rows.length; i += 100) {
      const { error: pErr } = await db.from("fkaios_knowledge_pages").insert(rows.slice(i, i + 100));
      if (pErr) throw new Error(`page insert failed: ${pErr.message}`);
    }
    const stillNeedOcr = rows.filter((r) => r.needs_ocr).length;
    const basis = pages.some((p) => p.labelBasis === "pdf_page_labels") ? "pdf_page_labels" : pages.some((p) => p.labelBasis) ? "printed_on_page" : "pdf_index_only";
    const status = stillNeedOcr > 0 ? "partial" : "complete";
    const report = { pages: pages.length, text_layer_pages: rows.filter((r) => r.extraction === "text_layer").length, ocr_pages: ocrDone, pages_needing_ocr: stillNeedOcr, ocr_errors: ocrErrors, label_basis: basis };
    await db.from("fkaios_knowledge_sources").update({ page_count: pages.length, page_label_basis: basis, ingestion_status: status, ingestion_report: report, updated_at: new Date().toISOString() }).eq("id", src.id);
    return { sourceId: src.id, duplicate: false, pages: pages.length, needsOcr: stillNeedOcr, ocrDone, status, report };
  } catch (e) {
    await db.from("fkaios_knowledge_sources").update({ ingestion_status: "failed", ingestion_report: { error: String(e).slice(0, 500) }, updated_at: new Date().toISOString() }).eq("id", src.id);
    throw e;
  }
}

/** Ingest plain text (a conversation history) in fixed line windows, each keeping its line range. */
export async function ingestText(db: Db, text: string, meta: SourceMeta, linesPerSegment = 60): Promise<IngestResult> {
  const bytes = new TextEncoder().encode(text);
  const sha = await sha256Hex(bytes);
  const existing = await existingSource(db, sha);
  if (existing) return { sourceId: existing.id, duplicate: true, pages: existing.page_count, needsOcr: 0, ocrDone: 0, status: existing.ingestion_status, report: {} };
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop(); // a final newline ends the last line; it is not a line
  const { data: src, error } = await db.from("fkaios_knowledge_sources").insert({ ...sourceRow(meta, sha, "text/plain"), page_label_basis: "line_ranges" }).select("id").single();
  if (error || !src) throw new Error(`could not create knowledge source: ${error?.message ?? "no row"}`);
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0, seg = 1; i < lines.length; i += linesPerSegment, seg++) {
    const chunk = lines.slice(i, i + linesPerSegment).join("\n");
    rows.push({ source_id: src.id, pdf_page: seg, printed_label: `lines ${i + 1}-${Math.min(lines.length, i + linesPerSegment)}`, label_basis: "line_range", line_start: i + 1, line_end: Math.min(lines.length, i + linesPerSegment), text: chunk, char_count: chunk.length, extraction: "plain_text", completeness: "complete" });
  }
  for (let i = 0; i < rows.length; i += 100) {
    const { error: pErr } = await db.from("fkaios_knowledge_pages").insert(rows.slice(i, i + 100));
    if (pErr) throw new Error(`segment insert failed: ${pErr.message}`);
  }
  const report = { lines: lines.length, bytes: bytes.length, segments: rows.length };
  await db.from("fkaios_knowledge_sources").update({ page_count: rows.length, ingestion_status: "complete", ingestion_report: report, updated_at: new Date().toISOString() }).eq("id", src.id);
  return { sourceId: src.id, duplicate: false, pages: rows.length, needsOcr: 0, ocrDone: 0, status: "complete", report };
}

export interface PageRequest { book: string; page: string; pageKind?: "printed" | "pdf" | "auto"; edition?: string | null }

export type PageAnswer =
  | { status: "found"; source: Record<string, unknown>; page: Record<string, unknown>; mapping: string; completeness: string; copyright_note: string | null }
  | { status: "clarify"; reason: string; candidates: Array<Record<string, unknown>> }
  | { status: "not_found"; reason: string };

const COPYRIGHT_NOTE: Record<string, string | null> = {
  owned: null, public_domain: null, licensed: "Licensed material: for internal use under the licence terms.",
  third_party_copyrighted: "Third-party copyrighted book: one page is returned for the founder's private reference; it must not be republished.",
  unknown: "Copyright status not recorded: treat as third-party material and do not republish.",
};

/** Resolve the book (title, filename, author, edition, ISBN) and return the requested page. */
export async function retrievePage(db: Db, req: PageRequest): Promise<PageAnswer> {
  const term = req.book.trim().replace(/[%_,()]/g, " ");
  if (!term) return { status: "not_found", reason: "no book named" };
  const { data } = await db.from("fkaios_knowledge_sources")
    .select("id,title,author,edition,isbn,filename,source_kind,storage_bucket,storage_path,provenance,page_count,page_label_basis,copyright_class,ingestion_status")
    .or(`title.ilike.%${term}%,filename.ilike.%${term}%,author.ilike.%${term}%,isbn.eq.${term}`)
    .neq("ingestion_status", "failed");
  let sources = (data ?? []) as Array<Record<string, unknown>>;
  if (req.edition) sources = sources.filter((s) => String(s.edition ?? "").toLowerCase().includes(req.edition!.toLowerCase()));
  if (sources.length === 0) return { status: "not_found", reason: `no indexed document matches "${req.book}"${req.edition ? ` (edition ${req.edition})` : ""}` };
  if (sources.length > 1) {
    return { status: "clarify", reason: "more than one indexed document or edition matches; name the edition or the exact title",
      candidates: sources.map((s) => ({ id: s.id, title: s.title, edition: s.edition, author: s.author, filename: s.filename, pages: s.page_count })) };
  }
  const source = sources[0];
  const kind = req.pageKind ?? "auto";
  const cols = "pdf_page,printed_label,label_basis,text,char_count,extraction,ocr_resource,needs_ocr,completeness";
  let page: Record<string, unknown> | null = null, mapping = "";
  if (kind !== "pdf") {
    const { data: byLabel } = await db.from("fkaios_knowledge_pages").select(cols).eq("source_id", source.id).eq("printed_label", req.page).order("pdf_page").limit(2);
    if (byLabel?.length === 1) { page = byLabel[0]; mapping = `printed page ${req.page} = PDF page ${byLabel[0].pdf_page} (${byLabel[0].label_basis})`; }
    else if ((byLabel?.length ?? 0) > 1) return { status: "clarify", reason: `printed label "${req.page}" occurs on more than one PDF page`, candidates: byLabel!.map((p: Record<string, unknown>) => ({ pdf_page: p.pdf_page, printed_label: p.printed_label })) };
  }
  if (!page && kind !== "printed" && /^\d+$/.test(req.page)) {
    const { data: byIndex } = await db.from("fkaios_knowledge_pages").select(cols).eq("source_id", source.id).eq("pdf_page", Number(req.page)).maybeSingle();
    if (byIndex) { page = byIndex; mapping = `PDF page ${req.page}${byIndex.printed_label ? ` (printed "${byIndex.printed_label}")` : " (no printed label known)"}${kind === "auto" ? "; no page is printed with that number, so the PDF index was used" : ""}`; }
  }
  if (!page) return { status: "not_found", reason: `${source.title} has no ${kind === "pdf" ? "PDF" : kind === "printed" ? "printed" : ""} page "${req.page}" (it has ${source.page_count} PDF pages)` };
  return { status: "found", source, page, mapping, completeness: String(page.completeness), copyright_note: COPYRIGHT_NOTE[String(source.copyright_class)] ?? null };
}

/** Ranked passages for a question, with source and page or line references. */
export async function searchKnowledge(db: Db, query: string, kind: SourceKind | null = null, limit = 5): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db.rpc("fkaios_search_knowledge", { p_query: query, p_kind: kind, p_limit: limit });
  if (error) throw new Error(`knowledge search failed: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/** Remove a source (cascade deletes its pages). Used by self-tests for their own fixtures only. */
export async function deleteSource(db: Db, sourceId: string): Promise<void> {
  await db.from("fkaios_knowledge_sources").delete().eq("id", sourceId).eq("source_kind", "test_fixture");
}
