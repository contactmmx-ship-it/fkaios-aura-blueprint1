/// <reference lib="deno.ns" />
// Bulk-loads a zip of text/markdown documents from Storage into the FKAIOS knowledge library.
// Zip must contain manifest.json: [{id,title,date,p,n}] and <id>.md files.
// Auth: x-ingest-key header must match fkaios_ingest_keys row 'knowledge-bulk-ingest' (service-role only table).
// v2: smaller page batches (25) to stay under statement timeout; optional ids[] to retry specific docs.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";

const PAGE_CHARS = 4000;
const PAGE_BATCH = 25;

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function paginate(text: string) {
  const lines = text.split("\n");
  const pages: { start: number; end: number; text: string }[] = [];
  let buf: string[] = [], len = 0, start = 1;
  const flush = (end: number) => { if (buf.length) { pages.push({ start, end, text: buf.join("\n") }); buf = []; len = 0; start = end + 1; } };
  lines.forEach((raw, i) => {
    let line = raw;
    while (line.length > PAGE_CHARS) {
      flush(i);
      pages.push({ start: i + 1, end: i + 1, text: line.slice(0, PAGE_CHARS) });
      line = line.slice(PAGE_CHARS); start = i + 1;
    }
    if (len + line.length + 1 > PAGE_CHARS && buf.length) flush(i);
    buf.push(line); len += line.length + 1;
  });
  flush(lines.length);
  return pages.filter((p) => p.text.trim().length);
}

Deno.serve(async (req) => {
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: k } = await db.from("fkaios_ingest_keys").select("key").eq("name", "knowledge-bulk-ingest").single();
    if (!k || req.headers.get("x-ingest-key") !== k.key) return new Response("forbidden", { status: 403 });

    const { bucket = "documents", path, offset = 0, limit = 50, ids = null, provenance = "", copyright_class = "owned" } = await req.json();
    const { data: blob, error: dErr } = await db.storage.from(bucket).download(path);
    if (dErr || !blob) return Response.json({ error: "download failed", detail: dErr?.message }, { status: 400 });
    const zipBytes = new Uint8Array(await blob.arrayBuffer());
    const manifest = JSON.parse(strFromU8(unzipSync(zipBytes, { filter: (f) => f.name === "manifest.json" })["manifest.json"]));
    const slice = ids ? manifest.filter((m: any) => ids.includes(m.id)) : manifest.slice(offset, offset + limit);
    const want = new Set(slice.map((m: any) => m.id + ".md"));
    const files = unzipSync(zipBytes, { filter: (f) => want.has(f.name) });

    const report = { total: manifest.length, offset, done: 0, skipped: 0, pages: 0, failed: [] as string[] };
    for (const m of slice) {
      try {
        const f = files[m.id + ".md"];
        if (!f) { report.failed.push(m.id + ":missing"); continue; }
        const text = strFromU8(f);
        const sha = await sha256(text);
        const { data: ex } = await db.from("fkaios_knowledge_sources").select("id,ingestion_status").eq("sha256", sha).maybeSingle();
        if (ex && ex.ingestion_status === "complete") { report.skipped++; continue; }
        if (ex) {
          for (;;) { // delete old pages in small chunks
            const { data: old } = await db.from("fkaios_knowledge_pages").select("id").eq("source_id", ex.id).limit(200);
            if (!old || !old.length) break;
            await db.from("fkaios_knowledge_pages").delete().in("id", old.map((o: any) => o.id));
          }
          await db.from("fkaios_knowledge_sources").delete().eq("id", ex.id);
        }
        const pages = paginate(text);
        const { data: src, error: sErr } = await db.from("fkaios_knowledge_sources").insert({
          title: `ChatGPT: ${m.title} (${m.date})`, source_kind: "conversation", filename: m.id + ".md",
          storage_bucket: bucket, storage_path: `${path}#${m.id}.md`, provenance, sha256: sha, mime_type: "text/markdown",
          page_count: pages.length, page_label_basis: "line_ranges", copyright_class, project_ref: m.p,
          ingestion_status: "ingesting", ingestion_report: { chat_id: m.id, date: m.date, messages: m.n },
        }).select("id").single();
        if (sErr || !src) { report.failed.push(m.id + ":" + sErr?.message); continue; }
        const rows = pages.map((p, i) => ({ source_id: src.id, pdf_page: i + 1, printed_label: `lines ${p.start}-${p.end}`, label_basis: "line_range",
          line_start: p.start, line_end: p.end, text: p.text, char_count: p.text.length, extraction: "plain_text", completeness: "complete" }));
        let ok = true;
        for (let i = 0; i < rows.length; i += PAGE_BATCH) {
          const { error } = await db.from("fkaios_knowledge_pages").insert(rows.slice(i, i + PAGE_BATCH));
          if (error) { ok = false; report.failed.push(m.id + ":pages:" + error.message); break; }
        }
        await db.from("fkaios_knowledge_sources").update({ ingestion_status: ok ? "complete" : "partial" }).eq("id", src.id);
        if (ok) { report.done++; report.pages += rows.length; }
      } catch (e) { report.failed.push(m.id + ":" + String(e)); }
    }
    return Response.json(report);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
