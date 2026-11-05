// 5 Nov 2026 — Knowledge Vault "Add Document" writes into the ONE memory (fkaios_knowledge_sources/pages),
// the same store Brain Chat, objectives and Draft Studio search. Before this it wrote to a separate
// July-era store (brain_knowledge_documents) that the brain never reads. Pure helpers, unit-tested.

export const MAX_DOC_CHARS = 200_000;
export const PAGE_CHARS = 3_000;

export interface DocPage { page: number; line_start: number; line_end: number; text: string }

/** Validates title/content; returns an error message or null. */
export function checkDocument(title: unknown, content: unknown): string | null {
  if (typeof title !== "string" || !title.trim()) return "Title is required.";
  if (title.trim().length > 200) return "Title is too long (200 characters max).";
  if (typeof content !== "string" || !content.trim()) return "Content is required.";
  if (content.length > MAX_DOC_CHARS) return `Document is too long (${MAX_DOC_CHARS.toLocaleString("en-IN")} characters max). Split it into parts.`;
  return null;
}

/** Splits text into pages of whole lines (about PAGE_CHARS each), keeping line numbers for citation. */
export function splitPages(content: string, max = PAGE_CHARS): DocPage[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const pages: DocPage[] = [];
  let buf: string[] = [], start = 1, size = 0;
  const flush = (end: number) => {
    const text = buf.join("\n").trim();
    if (text) pages.push({ page: pages.length + 1, line_start: start, line_end: end, text });
    buf = []; size = 0; start = end + 1;
  };
  lines.forEach((line, i) => {
    // a single line longer than a page is cut into page-sized pieces
    for (let rest = line; ; ) {
      const room = max - size;
      if (rest.length <= room) { buf.push(rest); size += rest.length + 1; break; }
      if (buf.length) { flush(i); start = i + 1; continue; }
      buf.push(rest.slice(0, max)); rest = rest.slice(max); flush(i + 1); start = i + 1;
    }
    if (size >= max) flush(i + 1);
  });
  flush(lines.length);
  return pages;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
