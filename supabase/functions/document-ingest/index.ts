// ═══════════════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v26 pulled 2026-07-05):
// ⚠️ CONFIRMED DEAD CODE — VERIFIED AGAINST LIVE DATABASE ⚠️
// This function reads/writes `knowledge_sources`, `knowledge_chunks`, and
// `knowledge_embeddings`. NONE of these tables exist in the live Supabase
// project (checked via information_schema.tables on 2026-07-05). Only
// `knowledge_documents` (partially) and `documents` exist among the
// tables this "Knowledge OS" family of functions expects.
// Concretely: Step 4 of handleIngest ("Verify source exists") queries
// `knowledge_sources` and will always return a 404 "Knowledge source not
// found" error, since that table doesn't exist — so POST ingestion is
// dead on arrival. GET status/list and DELETE would also fail as soon as
// they touch `knowledge_chunks` / `knowledge_embeddings`.
// This is the ingestion counterpart to knowledge-search (also confirmed
// dead in this same pass) — both are leftovers from an abandoned
// "Knowledge OS" pgvector-1536/OpenAI-ada-002 architecture that was
// superseded by vault-engine's real, working pgvector-384/gte-small
// pipeline (already verified end-to-end at 0.83 similarity).
// Synced here faithfully (unmodified) per instructions — not deleted,
// not rewired. Recommend deleting this function (and knowledge-search)
// once vault-engine's document ingestion path is confirmed to cover the
// same use case, or explicitly migrating it onto vault-engine's schema
// if a separate multi-format (pdf/docx/txt/md) chunking pipeline is
// still wanted. Decision left to the user.
// ═══════════════════════════════════════════════════════════════════════
// ============================================================================
// Knowledge OS — Document Ingest Edge Function
// ============================================================================
// Handles the full document ingestion pipeline:
//   Upload → Parse → Chunk → Embed → Store
//
// Supported methods:
//   POST   multipart/form-data  — Ingest a new document (file + metadata)
//   GET    ?id=UUID             — Check ingestion status
//   GET    ?source_id=UUID      — List documents for a knowledge source
//   DELETE ?id=UUID             — Delete document + cascading chunks/embeddings
//
// Environment variables required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, OPENAI_API_KEY
//
// Storage bucket: knowledge-docs (must be created in Supabase Dashboard)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";
import { recordMetric, measureLatency } from "../_shared/metrics.ts";

// ──────────────────────────────────────────────
// CORS headers
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Correlation-ID, apikey, x-client-info",
  "Access-Control-Expose-Headers": "X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const STORAGE_BUCKET = "knowledge-docs";
const MAX_CHUNK_TOKENS = 500;
const OVERLAP_TOKENS = 50;
const CHARS_PER_TOKEN = 4;
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;
const EMBEDDING_MODEL = "text-embedding-ada-002";
const EMBEDDING_DIMENSIONS = 1536;
const SUPPORTED_FILE_TYPES = ["pdf", "docx", "txt", "md"] as const;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface IngestMetadata {
  source_id: string;
  title: string;
  brand_id?: string;
  tags?: string[];
}

interface ChunkData {
  index: number;
  content: string;
  tokenCount: number;
  startChar: number;
  endChar: number;
}

// ──────────────────────────────────────────────
// Helpers — File type detection
// ──────────────────────────────────────────────
function detectFileType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (SUPPORTED_FILE_TYPES.includes(ext as typeof SUPPORTED_FILE_TYPES[number])) {
    return ext;
  }
  // Map common aliases
  if (ext === "markdown") return "md";
  return ext; // Will be validated downstream
}

// ──────────────────────────────────────────────
// Helpers — Text extraction from file bytes
// ──────────────────────────────────────────────
async function extractTextFromFile(
  fileBytes: Uint8Array,
  fileType: string,
  preParsedText?: string,
): Promise<{ text: string; metadata: Record<string, unknown> }> {
  const extractMeta: Record<string, unknown> = { fileType, extractedAt: new Date().toISOString() };

  switch (fileType) {
    case "pdf":
      // In Deno edge runtime, native PDF parsing is not available.
      // Accept pre-parsed text if provided, otherwise decode as UTF-8 (best-effort).
      if (preParsedText && preParsedText.trim().length > 0) {
        extractMeta.parseMethod = "pre-parsed-text";
        return { text: preParsedText.trim(), metadata: extractMeta };
      }
      // Fallback: attempt UTF-8 decode — will work for text-based PDFs
      // but not for binary-encoded PDFs. Production systems should parse
      // client-side before upload.
      try {
        const decoder = new TextDecoder("utf-8", { fatal: false });
        const rawText = decoder.decode(fileBytes);
        // Filter out non-printable characters common in binary PDFs
        const cleaned = rawText
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
          .trim();
        extractMeta.parseMethod = "utf8-fallback";
        extractMeta.warning = "PDF parsed with UTF-8 fallback — may be incomplete. Client-side parsing recommended.";
        return { text: cleaned, metadata: extractMeta };
      } catch {
        extractMeta.parseMethod = "failed";
        return { text: "", metadata: extractMeta };
      }

    case "docx":
      // DOCX requires XML parsing (zip extraction) not available in edge runtime.
      // Accept pre-parsed text from metadata.
      if (preParsedText && preParsedText.trim().length > 0) {
        extractMeta.parseMethod = "pre-parsed-text";
        return { text: preParsedText.trim(), metadata: extractMeta };
      }
      extractMeta.parseMethod = "failed";
      extractMeta.error = "DOCX parsing not available in edge runtime. Provide pre-parsed text in metadata.raw_text.";
      return { text: "", metadata: extractMeta };

    case "txt":
    case "md":
    case "markdown": {
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const text = decoder.decode(fileBytes).trim();
      extractMeta.parseMethod = "direct-decode";
      extractMeta.characterCount = text.length;
      return { text, metadata: extractMeta };
    }

    default:
      extractMeta.parseMethod = "unsupported";
      extractMeta.error = `Unsupported file type: ${fileType}`;
      return { text: "", metadata: extractMeta };
  }
}

// ──────────────────────────────────────────────
// Helpers — Text chunking with overlap
// ──────────────────────────────────────────────
function chunkText(rawText: string): ChunkData[] {
  if (!rawText || rawText.trim().length === 0) {
    return [];
  }

  // Normalize whitespace and split into paragraphs/sections
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const paragraphs = normalized.split(/\n\n+/).filter((p) => p.trim().length > 0);

  const chunks: ChunkData[] = [];
  let currentContent = "";
  let currentStart = 0;
  let charOffset = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    // If adding this paragraph exceeds max chunk size and we already have content,
    // finalize current chunk
    if (
      currentContent.length + trimmed.length > MAX_CHUNK_CHARS &&
      currentContent.length > 0
    ) {
      chunks.push({
        index: chunks.length,
        content: currentContent.trim(),
        tokenCount: Math.ceil(currentContent.length / CHARS_PER_TOKEN),
        startChar: currentStart,
        endChar: charOffset,
      });

      // Start new chunk with overlap from the end of the previous chunk
      const overlapStart = Math.max(0, currentContent.length - OVERLAP_CHARS);
      currentContent = currentContent.substring(overlapStart) + "\n\n";
      currentStart = charOffset - (currentContent.length - trimmed.length);
    }

    currentContent += trimmed + "\n\n";
    charOffset += trimmed.length + 2;
  }

  // Push remaining content as final chunk
  if (currentContent.trim().length > 0) {
    chunks.push({
      index: chunks.length,
      content: currentContent.trim(),
      tokenCount: Math.ceil(currentContent.length / CHARS_PER_TOKEN),
      startChar: currentStart,
      endChar: charOffset,
    });
  }

  // Handle edge case: single very long paragraph that exceeds chunk size
  const finalChunks: ChunkData[] = [];
  for (const chunk of chunks) {
    if (chunk.content.length > MAX_CHUNK_CHARS * 2) {
      // Split oversized chunks by sentences
      const sentences = chunk.content.split(/(?<=[.!?])\s+/);
      let subContent = "";
      let subStart = chunk.startChar;
      let subCharOffset = chunk.startChar;

      for (const sentence of sentences) {
        if (subContent.length + sentence.length > MAX_CHUNK_CHARS && subContent.length > 0) {
          finalChunks.push({
            index: 0, // Re-indexed below
            content: subContent.trim(),
            tokenCount: Math.ceil(subContent.length / CHARS_PER_TOKEN),
            startChar: subStart,
            endChar: subCharOffset,
          });

          const overlapStart = Math.max(0, subContent.length - OVERLAP_CHARS);
          subContent = subContent.substring(overlapStart);
          subStart = subCharOffset - subContent.length;
        }
        subContent += sentence + " ";
        subCharOffset += sentence.length + 1;
      }

      if (subContent.trim().length > 0) {
        finalChunks.push({
          index: 0,
          content: subContent.trim(),
          tokenCount: Math.ceil(subContent.length / CHARS_PER_TOKEN),
          startChar: subStart,
          endChar: subCharOffset,
        });
      }
    } else {
      finalChunks.push(chunk);
    }
  }

  // Re-index chunks
  finalChunks.forEach((c, i) => {
    c.index = i;
  });

  return finalChunks;
}

// ──────────────────────────────────────────────
// Helpers — OpenAI Embedding API call
// ──────────────────────────────────────────────
async function generateEmbedding(
  text: string,
  cid: string,
): Promise<number[]> {
  const startTime = performance.now();

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    structuredLog("ERROR", "OpenAI embedding API error", {
      status: response.status,
      statusText: response.statusText,
      errorBody: errorBody.substring(0, 500),
    }, cid);
    throw new Error(`OpenAI embedding API returned ${response.status}: ${errorBody.substring(0, 200)}`);
  }

  const data = await response.json();
  const elapsed = Math.round(performance.now() - startTime);

  await recordMetric(supabase, "openai_embedding_latency_ms", elapsed, {
    model: EMBEDDING_MODEL,
    function: "document-ingest",
  });

  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    throw new Error("Invalid embedding response from OpenAI — no embedding data returned");
  }

  const embedding = data.data[0].embedding as number[];

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    structuredLog("WARN", "Embedding dimension mismatch", {
      expected: EMBEDDING_DIMENSIONS,
      actual: embedding.length,
      model: EMBEDDING_MODEL,
    }, cid);
  }

  return embedding;
}

// ──────────────────────────────────────────────
// Helpers — Generate storage path
// ──────────────────────────────────────────────
function generateStoragePath(sourceId: string, filename: string): string {
  const sanitized = filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .substring(0, 200);
  const timestamp = Date.now();
  return `${sourceId}/${timestamp}_${sanitized}`;
}

// ──────────────────────────────────────────────
// POST — Full Document Ingestion Pipeline
// ──────────────────────────────────────────────
async function handleIngest(req: Request, cid: string): Promise<Response> {
  const pipelineStart = performance.now();
  structuredLog("INFO", "Starting document ingestion pipeline", {}, cid);

  // ── Step 1: Parse multipart/form-data ──
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const metadataStr = formData.get("metadata") as string | null;

  if (!file) {
    return errorResponse(
      "Missing required field 'file' in multipart form data",
      400,
      "Provide a file field with the document to ingest",
      cid,
    );
  }

  if (!metadataStr) {
    return errorResponse(
      "Missing required field 'metadata' in multipart form data",
      400,
      "Provide a metadata JSON string with: source_id, title, brand_id?, tags?",
      cid,
    );
  }

  let metadata: IngestMetadata;
  try {
    metadata = JSON.parse(metadataStr);
  } catch {
    return errorResponse(
      "Invalid metadata JSON",
      400,
      "metadata must be valid JSON with source_id and title",
      cid,
    );
  }

  if (!metadata.source_id || typeof metadata.source_id !== "string") {
    return errorResponse(
      "Missing or invalid 'source_id' in metadata",
      400,
      "source_id must be a valid UUID string",
      cid,
    );
  }

  if (!metadata.title || typeof metadata.title !== "string") {
    return errorResponse(
      "Missing or invalid 'title' in metadata",
      400,
      "title must be a non-empty string",
      cid,
    );
  }

  if (metadata.title.length > 500) {
    return errorResponse("Title too long: max 500 characters", 400, undefined, cid);
  }

  // ── Step 2: Determine file type ──
  const fileType = detectFileType(file.name);
  if (!SUPPORTED_FILE_TYPES.includes(fileType as typeof SUPPORTED_FILE_TYPES[number])) {
    return errorResponse(
      `Unsupported file type: .${fileType}`,
      400,
      `Supported types: ${SUPPORTED_FILE_TYPES.join(", ")}`,
      cid,
    );
  }

  structuredLog("INFO", "File parsed from form data", {
    filename: file.name,
    fileType,
    fileSize: file.size,
    sourceId: metadata.source_id,
    title: metadata.title,
  }, cid);

  // ── Step 3: Read file bytes ──
  const fileBytes = new Uint8Array(await file.arrayBuffer());

  // ── Step 4: Verify source exists ──
  // FLAG (sync note): `knowledge_sources` does not exist in the live
  // database — this query will always error, making POST ingestion
  // dead on arrival. See file header.
  const { data: source, error: sourceError } = await supabase
    .from("knowledge_sources")
    .select("id, name, brand_id")
    .eq("id", metadata.source_id)
    .single();

  if (sourceError || !source) {
    return errorResponse(
      `Knowledge source not found: ${metadata.source_id}`,
      404,
      sourceError?.message,
      cid,
    );
  }

  // ── Step 5: Extract text content ──
  structuredLog("INFO", "Extracting text from file", { fileType, filename: file.name }, cid);
  const preParsedText = (metadata as Record<string, unknown>).raw_text as string | undefined;
  const { text: extractedText, metadata: extractMeta } = await extractTextFromFile(
    fileBytes,
    fileType,
    preParsedText,
  );

  if (!extractedText || extractedText.trim().length === 0) {
    // Store the raw file but mark as failed parsing
    const storagePath = generateStoragePath(metadata.source_id, file.name);

    // Upload raw file to storage regardless
    try {
      await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, fileBytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    } catch (storageErr) {
      structuredLog("WARN", "Storage upload failed (non-fatal)", {
        error: storageErr instanceof Error ? storageErr.message : String(storageErr),
        storagePath,
      }, cid);
    }

    // Insert document record with failed status
    const { data: failedDoc, error: failedDocError } = await supabase
      .from("knowledge_documents")
      .insert({
        source_id: metadata.source_id,
        title: metadata.title,
        file_type: fileType,
        file_size: file.size,
        storage_path: storagePath,
        raw_text: extractedText,
        status: "failed",
        error_message: extractMeta.error as string || "Failed to extract text content from file",
        metadata: {
          ...extractMeta,
          brand_id: metadata.brand_id || source.brand_id,
          tags: metadata.tags || [],
        },
      })
      .select("id")
      .single();

    if (failedDocError) {
      return errorResponse(
        `Failed to create document record: ${failedDocError.message}`,
        500,
        undefined,
        cid,
      );
    }

    return errorResponse(
      "Failed to extract text content from file",
      422,
      extractMeta.error as string || "No text could be extracted. For PDF/DOCX, provide pre-parsed text in metadata.raw_text.",
      cid,
    );
  }

  // ── Step 6: Store raw file in Supabase Storage ──
  const storagePath = generateStoragePath(metadata.source_id, file.name);

  try {
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileBytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      structuredLog("WARN", "Storage upload failed (continuing with database-only ingest)", {
        error: uploadError.message,
        storagePath,
      }, cid);
      // Continue — document can still work without the stored file
    }
  } catch (storageErr) {
    structuredLog("WARN", "Storage upload exception (non-fatal)", {
      error: storageErr instanceof Error ? storageErr.message : String(storageErr),
    }, cid);
  }

  structuredLog("INFO", "Raw file stored", { storagePath }, cid);

  // ── Step 7: Insert into knowledge_documents (status='parsed') ──
  const { data: document, error: docInsertError } = await supabase
    .from("knowledge_documents")
    .insert({
      source_id: metadata.source_id,
      title: metadata.title,
      file_type: fileType,
      file_size: file.size,
      storage_path: storagePath,
      raw_text: extractedText,
      status: "parsed",
      metadata: {
        ...extractMeta,
        filename: file.name,
        brand_id: metadata.brand_id || source.brand_id,
        tags: metadata.tags || [],
      },
    })
    .select("id, title, status")
    .single();

  if (docInsertError || !document) {
    return errorResponse(
      `Failed to insert document record: ${docInsertError?.message}`,
      500,
      undefined,
      cid,
    );
  }

  const documentId = document.id;
  structuredLog("INFO", "Document record created", { documentId, title: document.title }, cid);

  // ── Step 8: Chunk the text ──
  const chunks = chunkText(extractedText);

  if (chunks.length === 0) {
    // No meaningful chunks generated — update to failed
    await supabase
      .from("knowledge_documents")
      .update({
        status: "failed",
        error_message: "No chunks generated from document text",
      })
      .eq("id", documentId);

    return errorResponse(
      "No text chunks could be generated from the document",
      422,
      "Document text was too short or contained no parseable content",
      cid,
    );
  }

  structuredLog("INFO", "Text chunked", {
    documentId,
    chunkCount: chunks.length,
    totalChars: extractedText.length,
  }, cid);

  // ── Step 9: Insert chunks into knowledge_chunks ──
  // FLAG (sync note): `knowledge_chunks` does not exist live — this
  // insert will fail every time this step is reached. See file header.
  const chunkInserts = chunks.map((chunk) => ({
    document_id: documentId,
    chunk_index: chunk.index,
    content: chunk.content,
    token_count: chunk.tokenCount,
    metadata: {
      start_char: chunk.startChar,
      end_char: chunk.endChar,
    },
  }));

  const { data: insertedChunks, error: chunkError } = await supabase
    .from("knowledge_chunks")
    .insert(chunkInserts)
    .select("id, chunk_index");

  if (chunkError || !insertedChunks) {
    // Rollback: mark document as failed
    await supabase
      .from("knowledge_documents")
      .update({
        status: "failed",
        error_message: `Chunk insertion failed: ${chunkError?.message}`,
      })
      .eq("id", documentId);

    return errorResponse(
      `Failed to insert chunks: ${chunkError?.message}`,
      500,
      undefined,
      cid,
    );
  }

  structuredLog("INFO", "Chunks inserted into database", {
    documentId,
    insertedCount: insertedChunks.length,
  }, cid);

  // ── Step 10: Generate embeddings for each chunk ──
  const embeddingInserts: Array<{
    chunk_id: string;
    embedding: number[];
    model: string;
  }> = [];
  let embeddingFailures = 0;

  for (const chunk of insertedChunks) {
    const chunkData = chunks.find((c) => c.index === chunk.chunk_index);
    if (!chunkData) continue;

    try {
      const embedding = await generateEmbedding(chunkData.content, cid);
      embeddingInserts.push({
        chunk_id: chunk.id,
        embedding,
        model: EMBEDDING_MODEL,
      });
    } catch (err) {
      embeddingFailures++;
      structuredLog("WARN", "Failed to generate embedding for chunk", {
        chunkId: chunk.id,
        chunkIndex: chunk.chunk_index,
        error: err instanceof Error ? err.message : String(err),
      }, cid);
    }

    // Small delay to avoid OpenAI rate limits
    if (embeddingInserts.length % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // ── Step 11: Insert embeddings into knowledge_embeddings ──
  // FLAG (sync note): `knowledge_embeddings` does not exist live — this
  // insert will fail every time this step is reached. See file header.
  if (embeddingInserts.length > 0) {
    // Insert in batches of 50 to avoid payload size limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < embeddingInserts.length; i += BATCH_SIZE) {
      const batch = embeddingInserts.slice(i, i + BATCH_SIZE);
      const { error: embError } = await supabase
        .from("knowledge_embeddings")
        .insert(batch);

      if (embError) {
        structuredLog("ERROR", "Failed to insert embedding batch", {
          batchIndex: i,
          batchSize: batch.length,
          error: embError.message,
        }, cid);
        embeddingFailures += batch.length;
      }
    }

    structuredLog("INFO", "Embeddings inserted into database", {
      documentId,
      insertedEmbeddings: embeddingInserts.length,
      failures: embeddingFailures,
    }, cid);
  }

  // ── Step 12: Update document status and chunk_count ──
  const finalStatus = embeddingFailures > 0
    ? (embeddingInserts.length > 0 ? "embedded" : "failed")
    : "embedded";

  const finalError = embeddingFailures === insertedChunks.length
    ? "All embedding generations failed"
    : embeddingFailures > 0
      ? `${embeddingFailures}/${insertedChunks.length} embeddings failed`
      : null;

  await supabase
    .from("knowledge_documents")
    .update({
      status: finalStatus,
      chunk_count: insertedChunks.length,
      error_message: finalError,
    })
    .eq("id", documentId);

  const pipelineElapsed = Math.round(performance.now() - pipelineStart);

  await recordMetric(supabase, "document_ingest_latency_ms", pipelineElapsed, {
    fileType,
    chunkCount: insertedChunks.length,
    embeddingCount: embeddingInserts.length,
    sourceId: metadata.source_id,
    function: "document-ingest",
    success: finalStatus !== "failed",
  });

  if (finalStatus === "failed") {
    return errorResponse(
      "Document ingestion completed with errors",
      500,
      finalError || "Unknown error during ingestion pipeline",
      cid,
    );
  }

  structuredLog("INFO", "Document ingestion complete", {
    documentId,
    title: document.title,
    chunkCount: insertedChunks.length,
    embeddingCount: embeddingInserts.length,
    failures: embeddingFailures,
    pipelineLatencyMs: pipelineElapsed,
  }, cid);

  return successResponse({
    success: true,
    document_id: documentId,
    title: document.title,
    status: finalStatus,
    chunk_count: insertedChunks.length,
    embedding_count: embeddingInserts.length,
    embedding_failures: embeddingFailures,
    storage_path: storagePath,
    pipeline_latency_ms: pipelineElapsed,
  }, 201, cid);
}

// ──────────────────────────────────────────────
// GET ?id=UUID — Check ingestion status
// ──────────────────────────────────────────────
async function handleGetStatus(req: Request, cid: string): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return errorResponse("Missing required query parameter 'id'", 400, undefined, cid);
  }

  structuredLog("INFO", "Checking document ingestion status", { documentId: id }, cid);

  const { data: doc, error } = await supabase
    .from("knowledge_documents")
    .select("id, source_id, title, file_type, file_size, status, chunk_count, error_message, metadata, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error || !doc) {
    return errorResponse("Document not found", 404, error?.message, cid);
  }

  // Fetch chunk details if embedded
  let chunks: Array<{ id: string; chunk_index: number; token_count: number }> | null = null;
  if (doc.status === "embedded" || doc.status === "chunked") {
    const { data: chunkData } = await supabase
      .from("knowledge_chunks")
      .select("id, chunk_index, token_count")
      .eq("document_id", id)
      .order("chunk_index", { ascending: true });

    chunks = chunkData || [];
  }

  return successResponse({
    success: true,
    document: doc,
    chunks,
  }, 200, cid);
}

// ──────────────────────────────────────────────
// GET ?source_id=UUID — List documents for a source
// ──────────────────────────────────────────────
async function handleListBySource(req: Request, cid: string): Promise<Response> {
  const url = new URL(req.url);
  const sourceId = url.searchParams.get("source_id");

  if (!sourceId) {
    return errorResponse("Missing required query parameter 'source_id'", 400, undefined, cid);
  }

  // Pagination support
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const statusFilter = url.searchParams.get("status");

  structuredLog("INFO", "Listing documents for source", { sourceId, limit, offset, statusFilter }, cid);

  let query = supabase
    .from("knowledge_documents")
    .select("id, source_id, title, file_type, file_size, status, chunk_count, error_message, created_at, updated_at", { count: "exact" })
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data: documents, error, count } = await query;

  if (error) {
    return errorResponse(
      `Failed to fetch documents: ${error.message}`,
      500,
      undefined,
      cid,
    );
  }

  return successResponse({
    success: true,
    documents: documents || [],
    total: count || 0,
    limit,
    offset,
    hasMore: (count || 0) > offset + limit,
  }, 200, cid);
}

// ──────────────────────────────────────────────
// DELETE ?id=UUID — Delete document + cascade
// ──────────────────────────────────────────────
async function handleDelete(req: Request, cid: string): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return errorResponse("Missing required query parameter 'id'", 400, undefined, cid);
  }

  structuredLog("INFO", "Deleting document and cascading data", { documentId: id }, cid);

  // Fetch document to get storage_path and source_id
  const { data: doc, error: docError } = await supabase
    .from("knowledge_documents")
    .select("id, source_id, title, storage_path, status")
    .eq("id", id)
    .single();

  if (docError || !doc) {
    return errorResponse("Document not found", 404, docError?.message, cid);
  }

  // Count what we're deleting for the response
  const { count: chunkCount } = await supabase
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", id);

  const { count: embeddingCount } = await supabase
    .from("knowledge_embeddings")
    .select("id", { count: "exact", head: true })
    .innerJoin("knowledge_chunks", "knowledge_embeddings.chunk_id", "knowledge_chunks.id")
    .eq("knowledge_chunks.document_id", id);

  // Delete embeddings (via chunk_id)
  // Due to cascade, deleting chunks should delete embeddings too,
  // but we do it explicitly for safety
  await measureLatency(supabase, "document-ingest-delete-embeddings", async () => {
    // Get chunk IDs first
    const { data: chunkIds } = await supabase
      .from("knowledge_chunks")
      .select("id")
      .eq("document_id", id);

    if (chunkIds && chunkIds.length > 0) {
      await supabase
        .from("knowledge_embeddings")
        .delete()
        .in("chunk_id", chunkIds.map((c: { id: string }) => c.id));
    }
  });

  // Delete chunks
  await measureLatency(supabase, "document-ingest-delete-chunks", async () => {
    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", id);
  });

  // Delete document record
  const { error: deleteError } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return errorResponse(
      `Failed to delete document: ${deleteError.message}`,
      500,
      undefined,
      cid,
    );
  }

  // Delete from storage (best-effort)
  if (doc.storage_path) {
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([doc.storage_path]);
    } catch (storageErr) {
      structuredLog("WARN", "Storage deletion failed (non-fatal)", {
        error: storageErr instanceof Error ? storageErr.message : String(storageErr),
        storagePath: doc.storage_path,
      }, cid);
    }
  }

  structuredLog("INFO", "Document deleted successfully", {
    documentId: id,
    title: doc.title,
    deletedChunks: chunkCount || 0,
    deletedEmbeddings: embeddingCount || 0,
  }, cid);

  return successResponse({
    success: true,
    message: "Document deleted successfully",
    deleted: {
      document_id: id,
      title: doc.title,
      chunks_deleted: chunkCount || 0,
      embeddings_deleted: embeddingCount || 0,
      storage_path: doc.storage_path,
    },
  }, 200, cid);
}

// ──────────────────────────────────────────────
// Main Handler
// ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Correlation ID
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  const startTime = performance.now();

  structuredLog("INFO", `Document ingest request: ${req.method} ${req.url}`, {}, cid);

  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
      OPENAI_API_KEY: openaiApiKey,
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error — check edge function secrets", cid);
    }

    // JWT auth required for all operations
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    }

    structuredLog("INFO", "User authenticated", { userId: user.userId, role: user.role }, cid);

    const url = new URL(req.url);

    // Route: POST — Ingest document
    if (req.method === "POST") {
      const result = await handleIngest(req, cid);
      return result;
    }

    // Route: GET — Status check or list
    if (req.method === "GET") {
      if (url.searchParams.has("id")) {
        return await handleGetStatus(req, cid);
      }
      if (url.searchParams.has("source_id")) {
        return await handleListBySource(req, cid);
      }
      return errorResponse(
        "Missing required query parameter: 'id' or 'source_id'",
        400,
        "Use ?id=<uuid> for status or ?source_id=<uuid> to list",
        cid,
      );
    }

    // Route: DELETE — Remove document
    if (req.method === "DELETE") {
      return await handleDelete(req, cid);
    }

    return errorResponse("Method not allowed", 405, "Supported: GET, POST, DELETE", cid);
  } catch (err) {
    const elapsed = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : "Internal server error";

    structuredLog("ERROR", "Unhandled error in document-ingest", {
      error: message,
      stack: err instanceof Error ? err.stack?.substring(0, 500) : undefined,
      elapsedMs: elapsed,
    }, cid);

    await recordMetric(supabase, "error_count", 1, {
      function: "document-ingest",
      error_type: err instanceof Error ? err.name : "unknown",
      error_message: message.substring(0, 200),
    });

    return errorResponse(message, 500, undefined, cid);
  } finally {
    const elapsed = Math.round(performance.now() - startTime);
    structuredLog("INFO", "Request completed", { method: req.method, elapsedMs: elapsed }, cid);
  }
});
