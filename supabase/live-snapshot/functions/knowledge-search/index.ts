// ============================================================================
// Knowledge OS — Semantic Search Edge Function
// ============================================================================
// Performs semantic search against the knowledge base using cosine similarity
// on OpenAI embeddings stored in pgvector.
//
// POST /knowledge-search — Search the knowledge base:
//   Body: {
//     query: string,            (required)
//     top_k?: number,          (default 5, max 50)
//     brand_id?: UUID,         (optional filter)
//     source_id?: UUID,        (optional filter)
//     agent_id?: UUID,         (optional — logged for audit)
//     threshold?: number,      (default 0.7 — cosine similarity floor)
//     include_content?: boolean (default true — return chunk content)
//   }
//
// Returns:
//   {
//     success: true,
//     query: string,
//     results: [{
//       chunk_id: UUID,
//       chunk_index: number,
//       content: string,
//       token_count: number,
//       similarity: number,        (0–1, higher = more relevant)
//       document: {
//         id: UUID,
//         title: string,
//       },
//       source: {
//         id: UUID,
//         name: string,
//       }
//     }],
//     sources: [{ document_title, source_name, chunk_index, similarity }],
//     result_count: number,
//     search_latency_ms: number
//   }
//
// IMPORTANT RAG RULE:
//   Every AI agent MUST use this function for knowledge-grounded answers.
//   The response includes a `sources` array so agents can cite their sources.
//
// Environment variables required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, OPENAI_API_KEY
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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
const EMBEDDING_MODEL = "text-embedding-ada-002";
const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 50;
const DEFAULT_THRESHOLD = 0.7;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface SearchRequest {
  query: string;
  top_k?: number;
  brand_id?: string;
  source_id?: string;
  agent_id?: string;
  threshold?: number;
  include_content?: boolean;
}

interface SearchResult {
  chunk_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  similarity: number;
  document: {
    id: string;
    title: string;
  };
  source: {
    id: string;
    name: string;
  };
}

interface SourceCitation {
  document_title: string;
  source_name: string;
  chunk_index: number;
  similarity: number;
}

// ──────────────────────────────────────────────
// Helpers — Generate OpenAI embedding for a query
// ──────────────────────────────────────────────
async function embedQuery(query: string, cid: string): Promise<number[]> {
  const startTime = performance.now();

  structuredLog("INFO", "Generating query embedding", {
    queryLength: query.length,
    model: EMBEDDING_MODEL,
  }, cid);

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: query,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    structuredLog("ERROR", "OpenAI embedding API error during search", {
      status: response.status,
      statusText: response.statusText,
      errorBody: errorBody.substring(0, 500),
    }, cid);
    throw new Error(
      `OpenAI embedding API returned ${response.status}: ${errorBody.substring(0, 200)}`,
    );
  }

  const data = await response.json();
  const elapsed = Math.round(performance.now() - startTime);

  await recordMetric(supabase, "openai_embedding_latency_ms", elapsed, {
    model: EMBEDDING_MODEL,
    function: "knowledge-search",
    context: "query",
  });

  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    throw new Error("Invalid embedding response from OpenAI");
  }

  const embedding = data.data[0].embedding as number[];

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    structuredLog("WARN", "Embedding dimension mismatch in search", {
      expected: EMBEDDING_DIMENSIONS,
      actual: embedding.length,
    }, cid);
  }

  structuredLog("INFO", "Query embedding generated", {
    elapsedMs: elapsed,
    dimensions: embedding.length,
  }, cid);

  return embedding;
}

// ──────────────────────────────────────────────
// Helpers — Call the SQL semantic search function
// ──────────────────────────────────────────────
async function performSemanticSearch(
  queryEmbedding: number[],
  brandId: string | null,
  sourceId: string | null,
  topK: number,
  threshold: number,
  includeContent: boolean,
  cid: string,
): Promise<{ results: SearchResult[]; latencyMs: number }> {
  const searchStart = performance.now();

  structuredLog("INFO", "Calling semantic_search_knowledge()", {
    brandId,
    sourceId,
    topK,
    threshold,
    includeContent,
  }, cid);

  // Convert embedding array to pgvector format: '[0.1, 0.2, ...]'
  const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

  // Build the SQL function call with optional parameters
  const brandParam = brandId ? `'${brandId}'::uuid` : "NULL::uuid";
  const sourceParam = sourceId ? `'${sourceId}'::uuid` : "NULL::uuid";

  // Use rpc to call the SQL function
  // Note: Supabase's rpc doesn't support vector types directly in params,
  // so we use a raw SQL approach via the pg module pattern.
  // Alternative: call via supabase.rpc if the function accepts the vector as a parameter.
  const { data, error } = await supabase.rpc("semantic_search_knowledge", {
    p_query_embedding: queryEmbedding,
    p_brand_id: brandId,
    p_source_id: sourceId,
    p_limit: topK,
    p_threshold: threshold,
  });

  if (error) {
    structuredLog("ERROR", "semantic_search_knowledge() failed", {
      error: error.message,
      errorDetails: error.details,
      errorCode: error.code,
    }, cid);
    throw new Error(`Semantic search failed: ${error.message}`);
  }

  const searchElapsed = Math.round(performance.now() - searchStart);

  const results: SearchResult[] = (data || []).map(
    (row: Record<string, unknown>) => ({
      chunk_id: row.chunk_id as string,
      chunk_index: row.chunk_index as number,
      content: includeContent ? (row.content as string) : "",
      token_count: row.token_count as number,
      similarity: Math.round((row.similarity as number) * 10000) / 10000, // 4 decimal places
      document: {
        id: row.document_id as string,
        title: row.document_title as string,
      },
      source: {
        id: row.source_id as string,
        name: row.source_name as string,
      },
    }),
  );

  structuredLog("INFO", "Semantic search results returned", {
    resultCount: results.length,
    searchLatencyMs: searchElapsed,
  }, cid);

  return { results, latencyMs: searchElapsed };
}

// ──────────────────────────────────────────────
// Helpers — Log search to knowledge_search_log
// ──────────────────────────────────────────────
async function logSearch(params: {
  query: string;
  embedding: number[];
  resultsCount: number;
  topChunkIds: string[];
  agentId?: string;
  consultantId?: string;
  latencyMs: number;
  cid: string;
}): Promise<string | null> {
  try {
    const { data: logId, error } = await supabase.rpc("log_knowledge_search", {
      p_query: params.query,
      p_embedding: params.embedding,
      p_results_count: params.resultsCount,
      p_top_chunk_ids: params.topChunkIds,
      p_agent_id: params.agentId || null,
      p_consultant_id: params.consultantId || null,
      p_latency_ms: params.latencyMs,
    });

    if (error) {
      structuredLog("WARN", "Failed to log search", {
        error: error.message,
        query: params.query.substring(0, 100),
      }, params.cid);
      return null;
    }

    return logId as string;
  } catch (err) {
    structuredLog("WARN", "Search logging exception", {
      error: err instanceof Error ? err.message : String(err),
    }, params.cid);
    return null;
  }
}

// ──────────────────────────────────────────────
// POST — Semantic Search
// ──────────────────────────────────────────────
async function handleSearch(req: Request, cid: string, userId: string): Promise<Response> {
  const pipelineStart = performance.now();

  // Parse request body
  let body: SearchRequest;
  try {
    const rawBody = await req.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
    body = rawBody as SearchRequest;
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  // Validate required fields
  if (!body.query || typeof body.query !== "string" || body.query.trim().length === 0) {
    return errorResponse(
      "Missing or invalid 'query' field",
      400,
      "query must be a non-empty string describing what to search for",
      cid,
    );
  }

  if (body.query.length > 5000) {
    return errorResponse("Query too long: max 5000 characters", 400, undefined, cid);
  }

  // Parse and validate optional fields
  const topK = Math.min(Math.max(body.top_k || DEFAULT_TOP_K, 1), MAX_TOP_K);
  const threshold = body.threshold !== undefined
    ? Math.min(Math.max(body.threshold, 0), 1)
    : DEFAULT_THRESHOLD;
  const includeContent = body.include_content !== false; // default true
  const brandId = body.brand_id || null;
  const sourceId = body.source_id || null;
  const agentId = body.agent_id || null;

  // Validate UUIDs if provided
  if (brandId && !isValidUUID(brandId)) {
    return errorResponse("Invalid brand_id: must be a valid UUID", 400, undefined, cid);
  }
  if (sourceId && !isValidUUID(sourceId)) {
    return errorResponse("Invalid source_id: must be a valid UUID", 400, undefined, cid);
  }
  if (agentId && !isValidUUID(agentId)) {
    return errorResponse("Invalid agent_id: must be a valid UUID", 400, undefined, cid);
  }

  structuredLog("INFO", "Search parameters validated", {
    query: body.query.substring(0, 100),
    topK,
    threshold,
    brandId,
    sourceId,
    agentId,
    includeContent,
  }, cid);

  // Step 1: Generate embedding for the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(body.query.trim(), cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate query embedding";
    return errorResponse(message, 502, "OpenAI embedding service unavailable", cid);
  }

  // Step 2: Perform semantic search via SQL function
  let searchResult: { results: SearchResult[]; latencyMs: number };
  try {
    searchResult = await performSemanticSearch(
      queryEmbedding,
      brandId,
      sourceId,
      topK,
      threshold,
      includeContent,
      cid,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Semantic search failed";
    return errorResponse(message, 500, undefined, cid);
  }

  // Step 3: Build sources citation array (required for RAG compliance)
  const sources: SourceCitation[] = searchResult.results.map((r) => ({
    document_title: r.document.title,
    source_name: r.source.name,
    chunk_index: r.chunk_index,
    similarity: r.similarity,
  }));

  // Step 4: Log the search for audit
  const topChunkIds = searchResult.results.map((r) => r.chunk_id);
  const pipelineElapsed = Math.round(performance.now() - pipelineStart);

  const logId = await logSearch({
    query: body.query.trim(),
    embedding: queryEmbedding,
    resultsCount: searchResult.results.length,
    topChunkIds,
    agentId: agentId || undefined,
    consultantId: userId,
    latencyMs: pipelineElapsed,
    cid,
  });

  // Step 5: Record metrics
  await recordMetric(supabase, "knowledge_search_latency_ms", pipelineElapsed, {
    topK,
    threshold,
    resultCount: searchResult.results.length,
    brandId,
    sourceId,
    agentId,
    function: "knowledge-search",
    success: true,
  });

  await recordMetric(supabase, "knowledge_search_results_count", searchResult.results.length, {
    topK,
    threshold,
    function: "knowledge-search",
  });

  // Log warning if no results found
  if (searchResult.results.length === 0) {
    structuredLog("WARN", "No results found for knowledge search", {
      query: body.query.substring(0, 200),
      threshold,
      brandId,
      sourceId,
    }, cid);
  }

  structuredLog("INFO", "Knowledge search complete", {
    query: body.query.substring(0, 100),
    resultCount: searchResult.results.length,
    pipelineLatencyMs: pipelineElapsed,
    searchLatencyMs: searchResult.latencyMs,
    logId,
  }, cid);

  return successResponse({
    success: true,
    query: body.query.trim(),
    results: searchResult.results,
    sources,
    result_count: searchResult.results.length,
    search_latency_ms: searchResult.latencyMs,
    pipeline_latency_ms: pipelineElapsed,
    search_log_id: logId,
    metadata: {
      model: EMBEDDING_MODEL,
      threshold,
      top_k: topK,
      brand_id: brandId,
      source_id: sourceId,
      agent_id: agentId,
    },
  }, 200, cid);
}

// ──────────────────────────────────────────────
// Helpers — UUID validation
// ──────────────────────────────────────────────
function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
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

  structuredLog("INFO", `Knowledge search request: ${req.method} ${req.url}`, {}, cid);

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

    // JWT auth required
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    }

    structuredLog("INFO", "User authenticated", { userId: user.userId, role: user.role }, cid);

    // Route: POST — Semantic search
    if (req.method === "POST") {
      return await handleSearch(req, cid, user.userId);
    }

    // Unsupported method
    if (req.method === "GET") {
      return errorResponse(
        "Method not allowed for this function",
        405,
        "Use POST with JSON body: { query: string, top_k?: number, brand_id?: UUID, source_id?: UUID, agent_id?: UUID }",
        cid,
      );
    }

    return errorResponse("Method not allowed", 405, "Supported: POST", cid);
  } catch (err) {
    const elapsed = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : "Internal server error";

    structuredLog("ERROR", "Unhandled error in knowledge-search", {
      error: message,
      stack: err instanceof Error ? err.stack?.substring(0, 500) : undefined,
      elapsedMs: elapsed,
    }, cid);

    await recordMetric(supabase, "error_count", 1, {
      function: "knowledge-search",
      error_type: err instanceof Error ? err.name : "unknown",
      error_message: message.substring(0, 200),
    });

    return errorResponse(message, 500, undefined, cid);
  } finally {
    const elapsed = Math.round(performance.now() - startTime);
    structuredLog("INFO", "Request completed", { method: req.method, elapsedMs: elapsed }, cid);
  }
});
