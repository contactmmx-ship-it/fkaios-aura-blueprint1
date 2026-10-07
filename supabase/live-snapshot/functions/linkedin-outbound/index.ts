/**
 * LinkedIn Outbound Edge Function
 * ─────────────────────────────────────────────────────────────
 * LinkedIn API for outbound messaging and posting.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  IMPORTANT: LinkedIn API Restrictions                   │
 * │                                                         │
 * │  1. sendLinkedInMessage() — NOT IMPLEMENTED             │
 * │     LinkedIn's Marketing Partner API (formerly          │
 * │     "Marketing Solutions API") is required for outbound  │
 * │     messaging automation. This API is NOT generally     │
 * │     available — it requires:                            │
 * │       • LinkedIn Marketing Partner program approval       │
 * │       • w_member_social permission scope                 │
 * │       • Data processing agreement with LinkedIn         │
 * │     See: https://learn.microsoft.com/en-us/linkedin/     │
 * │          marketing/community-management/                 │
 * │                                                         │
 * │  2. postLinkedInUpdate() — Limited Availability          │
 * │     Posting to a company page/feed requires:            │
 * │       • LinkedIn Marketing API access (2-legged OAuth)  │
 * │       • w_member_social or r_liteprofile permission     │
 * │       • A Company Page (admin access required)           │
 * │     For member posts: use Share on LinkedIn API with    │
 * │     3-legged OAuth + w_member_social permission.         │
 * │     See: https://learn.microsoft.com/en-us/linkedin/     │
 * │          marketing/integrations/community-management/    │
 * │          shares/share-api/                               │
 * │                                                         │
 * │  To enable these features:                               │
 * │    1. Apply for LinkedIn Marketing Partner program      │
 * │    2. Set LINKEDIN_ACCESS_TOKEN in Edge Function secrets│
 * │    3. Set LINKEDIN_ORGANIZATION_ID (for company pages)   │
 * └─────────────────────────────────────────────────────────┘
 *
 * Required Environment Secrets (for postLinkedInUpdate):
 *   SUPABASE_URL               — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key
 *   LINKEDIN_ACCESS_TOKEN      — LinkedIn OAuth 2.0 access token
 *   LINKEDIN_ORGANIZATION_ID    — LinkedIn organization ID (optional, for company page posts)
 *
 * API Reference:
 *   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/share-api
 *   https://learn.microsoft.com/en-us/linkedin/shared/references/v2/ugc-post-api
 * ─────────────────────────────────────────────────────────────
 */

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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const linkedinAccessToken = Deno.env.get("LINKEDIN_ACCESS_TOKEN") ?? "";
const linkedinOrganizationId = Deno.env.get("LINKEDIN_ORGANIZATION_ID") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// LinkedIn API base URL
// ──────────────────────────────────────────────
const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";

// ──────────────────────────────────────────────
// sendLinkedInMessage(profileId, message)
//
// NOT IMPLEMENTED — LinkedIn's outbound messaging API
// is restricted to Marketing Partners only.
//
// LinkedIn does NOT provide a general-purpose API for
// sending 1:1 messages programmatically. The options are:
//
//   1. LinkedIn Marketing Partner API (requires partner approval)
//      — Can send InMail and message campaigns
//      — Requires w_member_social permission
//      — Subject to LinkedIn's spam and compliance rules
//
//   2. LinkedIn Conversation API (invite-only beta)
//      — Very limited availability
//      — For chatbots responding to messages, NOT outbound
//
//   3. LinkedIn InMail via Sales Navigator (CRM integration)
//      — Requires Sales Navigator license
//      — Different API, not Marketing API
//
// If you need outbound LinkedIn messaging:
//   - Apply at: https://business.linkedin.com/marketing-solutions/advertising
//   - Review: https://learn.microsoft.com/en-us/linkedin/marketing/
//              community-management/messages/message-templates/
// ──────────────────────────────────────────────
function sendLinkedInMessageNotImplemented(profileId: string, cid: string): never {
  structuredLog("ERROR", "sendLinkedInMessage called — NOT IMPLEMENTED", { profileId }, cid);

  const errorMessage =
    "LinkedIn outbound messaging is NOT IMPLEMENTED. " +
    "LinkedIn restricts programmatic messaging to approved Marketing Partners only. " +
    "To enable this feature, you must: " +
    "(1) Apply for LinkedIn Marketing Partner program at https://business.linkedin.com/marketing-solutions, " +
    "(2) Obtain w_member_social permission scope, " +
    "(3) Sign a data processing agreement with LinkedIn. " +
    "Alternative: Use LinkedIn Sales Navigator InMail API (requires Sales Navigator license). " +
    "For now, use WhatsApp outbound as your primary messaging channel.";

  throw new Error(errorMessage);
}

// ──────────────────────────────────────────────
// Action handler: send_message (NOT IMPLEMENTED)
// ──────────────────────────────────────────────
async function handleSendMessage(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { profile_id, message } = body;

  if (!profile_id || typeof profile_id !== "string") {
    return errorResponse("Missing or invalid 'profile_id' (string required)", 400, undefined, cid);
  }
  if (!message || typeof message !== "string") {
    return errorResponse("Missing or invalid 'message' (string required)", 400, undefined, cid);
  }

  try {
    sendLinkedInMessageNotImplemented(profile_id, cid);
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(
      "LinkedIn outbound messaging not available",
      501,
      messageText,
      cid,
    );
  }
}

// ──────────────────────────────────────────────
// postLinkedInUpdate(text, visibility)
//
// Posts a status update (share) to LinkedIn.
// Requires LinkedIn Marketing API access with a valid
// access token.
//
// Two modes:
//   1. Personal profile post (3-legged OAuth)
//      Uses the member's access token
//   2. Company page post (2-legged OAuth)
//      Requires LINKEDIN_ORGANIZATION_ID
//
// Uses the UGC Posts API for newer posts or
// the Share API for legacy posts.
// ──────────────────────────────────────────────
async function handlePostUpdate(req: Request, cid: string) {
  // Verify LinkedIn config
  if (!linkedinAccessToken) {
    structuredLog("ERROR", "LinkedIn not configured — missing access token", {}, cid);
    return errorResponse(
      "LinkedIn not configured",
      503,
      "Set LINKEDIN_ACCESS_TOKEN in Edge Function secrets. " +
      "To obtain a token: (1) Create a LinkedIn App at https://www.linkedin.com/developers, " +
      "(2) Request 'r_liteprofile' and 'w_member_social' scopes, " +
      "(3) Complete OAuth 2.0 flow to get access token.",
      cid,
    );
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

  const { text, visibility, author_type } = body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return errorResponse("Missing or invalid 'text' (non-empty string required)", 400, undefined, cid);
  }

  // LinkedIn has a 3000 character limit for posts
  if (text.length > 3000) {
    structuredLog("WARN", "Post text exceeds 3000 char limit, truncating", { originalLength: text.length }, cid);
  }

  const postVisibility = typeof visibility === "string" && ["PUBLIC", "CONNECTIONS"].includes(visibility)
    ? visibility
    : "PUBLIC";

  // Determine author: organization page or personal profile
  const authorType = typeof author_type === "string" && author_type === "organization" ? "organization" : "person";

  // Build author URN
  let authorUrn: string;
  if (authorType === "organization") {
    if (!linkedinOrganizationId) {
      return errorResponse(
        "Organization ID required for company page posts",
        400,
        "Set LINKEDIN_ORGANIZATION_ID in Edge Function secrets, or use author_type: 'person' for personal posts",
        cid,
      );
    }
    authorUrn = `urn:li:organization:${linkedinOrganizationId}`;
  } else {
    // For personal posts, we need the member's LinkedIn ID from the token
    // The UGC API can use "person" as a relative author
    authorUrn = "urn:li:person:me"; // The UGC API resolves "me" based on the access token
  }

  structuredLog("INFO", "Posting LinkedIn update", {
    authorUrn,
    visibility: postVisibility,
    textLength: text.length,
  }, cid);

  try {
    // Use UGC Posts API (newer, recommended)
    // POST /ugcPosts
    const postBody = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: {
            text: text.slice(0, 3000),
          },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": postVisibility,
      },
    };

    const response = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${linkedinAccessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(postBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      structuredLog("ERROR", "LinkedIn UGC Posts API failed", {
        status: response.status,
        body: errorBody,
        authorUrn,
      }, cid);

      // Parse LinkedIn error for actionable messages
      let linkedinError: Record<string, unknown> = {};
      try {
        linkedinError = JSON.parse(errorBody);
      } catch {
        // non-JSON error body
      }

      const errorMsg = (linkedinError?.message as string)
        || (linkedinError?.error as string)
        || `LinkedIn API returned ${response.status}`;

      // Handle common permission errors
      if (response.status === 403) {
        return errorResponse(
          "LinkedIn API access denied",
          403,
          `${errorMsg}. Ensure your access token has 'w_member_social' scope. ` +
          `For organization posts, verify your LinkedIn App has Organization access. ` +
          `Regenerate token at: https://www.linkedin.com/developers`,
          cid,
        );
      }

      if (response.status === 401) {
        return errorResponse(
          "LinkedIn access token expired or invalid",
          401,
          `${errorMsg}. Re-authorize via OAuth 2.0 flow to obtain a new access token.`,
          cid,
        );
      }

      return errorResponse(
        `LinkedIn post failed (${response.status})`,
        response.status,
        errorMsg,
        cid,
      );
    }

    const result = await response.json();

    // The UGC API returns the post ID in the "id" field
    structuredLog("INFO", "LinkedIn update posted", {
      postId: result.id,
      authorUrn,
      visibility: postVisibility,
    }, cid);

    // Log activity to agent_activity_log for observability
    try {
      await supabase.from("agent_activity_log").insert({
        activity_type: "linkedin_post",
        title: "LinkedIn post published",
        description: `Posted update to ${authorUrn} (${postVisibility})`,
        metadata: { post_id: result.id, author: authorUrn, visibility: postVisibility, text_length: text.length },
      });
    } catch (logErr) {
      structuredLog("WARN", "Failed to log activity to agent_activity_log", { error: String(logErr) }, cid);
    }

    return successResponse({
      success: true,
      post_id: result.id,
      author: authorUrn,
      visibility: postVisibility,
      text_preview: text.length > 100 ? text.slice(0, 100) + "..." : text,
      correlation_id: cid,
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error posting to LinkedIn";
    structuredLog("ERROR", "LinkedIn post failed", { error: message }, cid);
    return errorResponse(message, 502, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// Action handler: check_config
// Returns current LinkedIn API configuration status
// ──────────────────────────────────────────────
async function handleCheckConfig(cid: string) {
  const config = {
    access_token_configured: !!linkedinAccessToken,
    organization_id_configured: !!linkedinOrganizationId,
    messaging_available: false,
    posting_available: !!linkedinAccessToken,
    messaging_note: "NOT AVAILABLE — requires LinkedIn Marketing Partner program approval. See function header docs.",
    posting_note: !!linkedinAccessToken
      ? "Available — uses UGC Posts API with w_member_social scope"
      : "Set LINKEDIN_ACCESS_TOKEN to enable posting",
  };

  return successResponse({
    success: true,
    linkedin_config: config,
    correlation_id: cid,
  }, 200, cid);
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
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, undefined, cid);
    }

    // JWT required for all outbound actions
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
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
      case "send_message":
        // ── NOT IMPLEMENTED: LinkedIn outbound messaging restricted ──
        return await handleSendMessage(req, cid);

      case "post_update":
        // Posts a status update — requires LinkedIn access token
        return await handlePostUpdate(req, cid);

      case "check_config":
        // Returns LinkedIn API configuration status
        return await handleCheckConfig(cid);

      default:
        return errorResponse(
          `Unknown action: ${action}. Valid actions: send_message (not implemented), post_update, check_config`,
          400,
          undefined,
          cid,
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
