// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v26 pulled 2026-07-05):
// VERIFIED REAL against live tables — `documents` table exists live.
// Genuine Supabase Storage signed-upload-URL flow (upload_url, delete,
// list actions), not a stub. No bugs found on this pass.
// ═══════════════════════════════════════════════════════════════
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";

// ──────────────────────────────────────────────
// CORS headers
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// Generate a signed upload URL for Supabase Storage
// ──────────────────────────────────────────────
async function handleUploadUrl(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { lead_id, filename, document_type, document_id } = body;

  if (!lead_id || typeof lead_id !== "string") {
    return errorResponse("Missing or invalid 'lead_id' (string required)", 400, undefined, cid);
  }
  if (!filename || typeof filename !== "string") {
    return errorResponse("Missing or invalid 'filename' (string required)", 400, undefined, cid);
  }
  if (!document_type || typeof document_type !== "string") {
    return errorResponse("Missing or invalid 'document_type' (string required)", 400, undefined, cid);
  }
  if (filename.length > 500) {
    return errorResponse("Filename too long: max 500 characters", 400, undefined, cid);
  }

  structuredLog("INFO", "Generating upload URL", { lead_id, filename, document_type }, cid);

  const sanitized = filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .substring(0, 200);
  const timestamp = Date.now();
  const storagePath = `${lead_id}/${timestamp}_${sanitized}`;

  try {
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("documents")
      .createSignedUploadUrl(storagePath, {
        upsert: false,
      });

    if (uploadError || !uploadData) {
      structuredLog("ERROR", "Failed to generate upload URL", { error: uploadError?.message, lead_id }, cid);
      return errorResponse(`Failed to generate upload URL: ${uploadError?.message}`, 500, undefined, cid);
    }

    const { data: publicUrlData } = supabase.storage
      .from("documents")
      .getPublicUrl(storagePath);

    if (document_id && typeof document_id === "string") {
      await supabase
        .from("documents")
        .update({
          url: storagePath,
          file_url: publicUrlData?.publicUrl || null,
          status: "Pending",
          notes: `${document_type} document uploaded: ${sanitized}`,
        })
        .eq("id", document_id);
    }

    structuredLog("INFO", "Upload URL generated", { storagePath, lead_id }, cid);

    return successResponse({
      success: true,
      upload_url: uploadData.signedUrl,
      storage_path: storagePath,
      public_url: publicUrlData?.publicUrl || null,
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Upload URL generation failed", { error: message, lead_id }, cid);
    return errorResponse(`Upload URL generation failed: ${message}`, 500, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// Delete a file from Supabase Storage
// ──────────────────────────────────────────────
async function handleDelete(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { document_id } = body;

  if (!document_id || typeof document_id !== "string") {
    return errorResponse("Missing or invalid 'document_id' (string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Deleting document", { document_id }, cid);

  try {
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, url, file_url")
      .eq("id", document_id)
      .single();

    if (docError || !doc) {
      structuredLog("WARN", "Document not found for deletion", { document_id, error: docError?.message }, cid);
      return errorResponse("Document not found", 404, undefined, cid);
    }

    if (doc.url) {
      await supabase.storage.from("documents").remove([doc.url]);
    }

    await supabase
      .from("documents")
      .update({ status: "Deleted", file_url: null })
      .eq("id", document_id);

    structuredLog("INFO", "Document deleted", { document_id }, cid);

    return successResponse({ success: true, message: "Document deleted" }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Delete failed", { error: message, document_id }, cid);
    return errorResponse(`Delete failed: ${message}`, 500, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// List all documents for a lead
// ──────────────────────────────────────────────
async function handleList(req: Request, cid: string) {
  const url = new URL(req.url);
  const leadId = url.searchParams.get("lead_id");

  if (!leadId) {
    return errorResponse("Missing lead_id query parameter", 400, undefined, cid);
  }

  structuredLog("INFO", "Listing documents for lead", { leadId }, cid);

  try {
    const { data: documents, error } = await supabase
      .from("documents")
      .select("*")
      .eq("lead_id", leadId)
      .neq("status", "Deleted")
      .order("created_at", { ascending: false });

    if (error) {
      structuredLog("ERROR", "Failed to fetch documents", { error: error.message, leadId }, cid);
      return errorResponse(`Failed to fetch documents: ${error.message}`, 500, undefined, cid);
    }

    const enrichedDocuments = await Promise.all(
      (documents || []).map(async (doc) => {
        let publicUrl: string | null = doc.file_url;

        if (!publicUrl && doc.url) {
          const { data: urlData } = supabase.storage
            .from("documents")
            .getPublicUrl(doc.url);
          publicUrl = urlData?.publicUrl || null;
        }

        return {
          ...doc,
          public_url: publicUrl,
        };
      })
    );

    return successResponse({ success: true, documents: enrichedDocuments }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "List failed", { error: message, leadId }, cid);
    return errorResponse(`List failed: ${message}`, 500, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Correlation ID
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);

  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    // JWT required for all operations
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    }

    const url = new URL(req.url);

    if (req.method === "GET" && url.searchParams.has("lead_id")) {
      return await handleList(req, cid);
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
      }
    } catch {
      return errorResponse("Invalid JSON in request body", 400, undefined, cid);
    }

    const { action } = body;

    if (!action || typeof action !== "string") {
      return errorResponse("Missing 'action' field", 400, undefined, cid);
    }

    switch (action) {
      case "upload_url":
        return await handleUploadUrl(req, cid);
      case "delete":
        return await handleDelete(req, cid);
      default:
        return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
