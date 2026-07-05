// Supabase Edge Function: WhatsApp Template Manager
// Deno runtime with npm: imports

import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

interface JwtPayload {
  sub: string;
  role: string;
  aud: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

interface TemplateComponent {
  type: string;
  text?: string;
  parameters?: Array<{ type: string; text: string }>;
  buttons?: Array<{
    type: string;
    text?: string;
    url?: string;
    phone_number?: string;
    payload?: string;
  }>;
  [key: string]: unknown;
}

interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components?: TemplateComponent[];
}

interface MetaTemplatesResponse {
  data: Array<{
    name: string;
    language: string;
    status: string;
    category: string;
    components?: TemplateComponent[];
    id: string;
  }>;
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
}

interface CreateTemplateRequest {
  name: string;
  category: string;
  language: string;
  body_text: string;
  header_text?: string;
  footer_text?: string;
  button_type?: "none" | "quick_reply" | "url" | "call_to_action";
  buttons?: Array<{
    type: string;
    text?: string;
    url?: string;
    phone_number?: string;
  }>;
}

// ─── In-Memory Cache ────────────────────────────────────────────────────────

const templateCache: {
  data: WhatsAppTemplate[];
  expiresAt: number;
} = {
  data: [],
  expiresAt: 0,
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCorrelationId(): string {
  return `tmpl-mgr-${crypto.randomUUID().slice(0, 8)}`;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function structuredLog(
  correlationId: string,
  level: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    correlationId,
    level,
    function: "whatsapp-template-manager",
    message,
    ...(data && { data }),
  };
  console.log(JSON.stringify(entry));
}

function verifyJwt(token: string, jwtSecret: string): JwtPayload {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format: expected 3 parts");
    }

    const headerB64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const signatureB64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");

    const header = JSON.parse(atob(headerB64));
    if (header.alg !== "HS256") {
      throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
    }

    const signingInput = `${parts[0]}.${parts[1]}`;
    const expectedSignature = createHmac("sha256", jwtSecret)
      .update(signingInput)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const actualSignature = signatureB64;
    const sigBuffer = Buffer.from(actualSignature, "base64");
    const expectedBuffer = Buffer.from(expectedSignature, "base64");

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new Error("JWT signature verification failed");
    }

    const payload = JSON.parse(atob(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error("JWT has expired");
    }
    if (payload.aud !== "authenticated") {
      throw new Error(`Invalid JWT audience: expected "authenticated", got "${payload.aud}"`);
    }

    return payload as JwtPayload;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("JWT verification failed: unknown error");
  }
}

function verifyWhatsappCredentials(correlationId: string): string {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!token) {
    structuredLog(correlationId, "ERROR", "WhatsApp credentials missing", {
      missingVar: "WHATSAPP_ACCESS_TOKEN",
    });
    throw new Error(
      "WhatsApp template manager failed: WHATSAPP_ACCESS_TOKEN not configured. Meta Business verification and WhatsApp Business API access required. Founder action: Complete Meta Business Suite verification → WhatsApp Manager → API setup."
    );
  }
  return token;
}

/**
 * Build Meta-compatible template components array from request.
 */
function buildTemplateComponents(request: CreateTemplateRequest): TemplateComponent[] {
  const components: TemplateComponent[] = [];

  // Header (optional)
  if (request.header_text) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: request.header_text,
    });
  }

  // Body (required by Meta)
  components.push({
    type: "BODY",
    text: request.body_text,
  });

  // Footer (optional)
  if (request.footer_text) {
    components.push({
      type: "FOOTER",
      text: request.footer_text,
    });
  }

  // Buttons (optional)
  if (request.buttons && request.buttons.length > 0 && request.button_type !== "none") {
    components.push({
      type: "BUTTONS",
      buttons: request.buttons.map((btn) => {
        switch (btn.type) {
          case "quick_reply":
            return {
              type: "quick_reply" as const,
              parameters: { display_text: btn.text ?? "Button" },
            };
          case "url":
            return {
              type: "url" as const,
              parameters: {
                display_text: btn.text ?? "Visit Link",
                url: btn.url ?? "",
              },
            };
          case "phone_number":
            return {
              type: "phone_number" as const,
              parameters: {
                display_text: btn.text ?? "Call Us",
                phone_number: btn.phone_number ?? "",
              },
            };
          default:
            return {
              type: "quick_reply" as const,
              parameters: { display_text: btn.text ?? "Button" },
            };
        }
      }),
    });
  }

  return components;
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

async function handleListTemplates(
  correlationId: string
): Promise<Response> {
  // Check cache
  const now = Date.now();
  if (templateCache.data.length > 0 && now < templateCache.expiresAt) {
    structuredLog(correlationId, "INFO", "Returning cached templates", {
      count: templateCache.data.length,
    });
    return new Response(
      JSON.stringify({ templates: templateCache.data, cached: true }),
      {
        status: 200,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const accessToken = verifyWhatsappCredentials(correlationId);
  const businessAccountId = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");

  if (!businessAccountId) {
    return new Response(
      JSON.stringify({
        error:
          "WhatsApp template manager failed: WHATSAPP_BUSINESS_ACCOUNT_ID not configured. Founder action: Meta Business Suite → WhatsApp Manager → Copy Business Account ID.",
      }),
      {
        status: 503,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  structuredLog(correlationId, "INFO", "Fetching templates from Meta API", {
    businessAccountId,
  });

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/v18.0/${businessAccountId}/message_templates?limit=100&status=APPROVED`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  } catch (fetchErr) {
    structuredLog(correlationId, "ERROR", "Meta API fetch failed", {
      error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
    });
    return new Response(
      JSON.stringify({
        error: `Failed to reach Meta Graph API: ${fetchErr instanceof Error ? fetchErr.message : "Network error"}`,
      }),
      {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const body: MetaTemplatesResponse = await response.json();

  if (!response.ok) {
    structuredLog(correlationId, "ERROR", "Meta API error listing templates", {
      status: response.status,
      error: body,
    });
    return new Response(
      JSON.stringify({
        error: `Meta API error: ${JSON.stringify(body)}`,
      }),
      {
        status: response.status >= 500 ? 502 : 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Also fetch PENDING templates
  const pendingTemplates: WhatsAppTemplate[] = [];
  try {
    const pendingResponse = await fetch(
      `https://graph.facebook.com/v18.0/${businessAccountId}/message_templates?limit=100&status=PENDING`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (pendingResponse.ok) {
      const pendingBody: MetaTemplatesResponse = await pendingResponse.json();
      if (pendingBody.data) {
        for (const t of pendingBody.data) {
          pendingTemplates.push({
            name: t.name,
            language: t.language,
            status: t.status,
            category: t.category,
            components: t.components,
          });
        }
      }
    }
  } catch {
    // Non-fatal — we still have the approved templates
    structuredLog(correlationId, "WARN", "Failed to fetch pending templates, continuing");
  }

  const allTemplates: WhatsAppTemplate[] = [];

  if (body.data) {
    for (const t of body.data) {
      allTemplates.push({
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category,
        components: t.components,
      });
    }
  }

  allTemplates.push(...pendingTemplates);

  // Update cache
  templateCache.data = allTemplates;
  templateCache.expiresAt = now + CACHE_TTL_MS;

  structuredLog(correlationId, "INFO", "Templates fetched and cached", {
    total: allTemplates.length,
    approved: body.data?.length ?? 0,
    pending: pendingTemplates.length,
  });

  return new Response(
    JSON.stringify({ templates: allTemplates, cached: false }),
    {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    }
  );
}

async function handleCreateTemplate(
  correlationId: string,
  requestBody: CreateTemplateRequest
): Promise<Response> {
  const accessToken = verifyWhatsappCredentials(correlationId);
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!phoneNumberId) {
    return new Response(
      JSON.stringify({
        error:
          "WhatsApp template manager failed: WHATSAPP_PHONE_NUMBER_ID not configured. Founder action: Meta Business Suite → WhatsApp Manager → Phone Numbers → Copy Phone Number ID.",
      }),
      {
        status: 503,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Validate required fields
  if (!requestBody.name || !requestBody.category || !requestBody.body_text) {
    return new Response(
      JSON.stringify({
        error:
          "Missing required fields: name, category, body_text",
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Validate category
  const validCategories = [
    "AUTHENTICATION",
    "MARKETING",
    "UTILITY",
    "TRANSACTIONAL",
  ];
  if (!validCategories.includes(requestBody.category.toUpperCase())) {
    return new Response(
      JSON.stringify({
        error: `Invalid category "${requestBody.category}". Must be one of: ${validCategories.join(", ")}`,
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const components = buildTemplateComponents(requestBody);

  const payload = {
    name: requestBody.name,
    category: requestBody.category.toUpperCase(),
    language: requestBody.language || "en",
    components,
  };

  structuredLog(correlationId, "INFO", "Creating WhatsApp template", {
    name: requestBody.name,
    category: requestBody.category,
    language: requestBody.language || "en",
    componentCount: components.length,
  });

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/message_templates`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
  } catch (fetchErr) {
    structuredLog(correlationId, "ERROR", "Meta API fetch failed", {
      error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
    });
    return new Response(
      JSON.stringify({
        error: `Failed to reach Meta Graph API: ${fetchErr instanceof Error ? fetchErr.message : "Network error"}`,
      }),
      {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const responseBody = await response.json();

  if (!response.ok) {
    structuredLog(correlationId, "ERROR", "Meta API error creating template", {
      status: response.status,
      error: responseBody,
    });
    return new Response(
      JSON.stringify({
        error: `Meta API error: ${responseBody.error?.message ?? JSON.stringify(responseBody)}`,
        meta_code: responseBody.error?.code,
        meta_type: responseBody.error?.type,
      }),
      {
        status: response.status >= 500 ? 502 : 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Invalidate cache since we've added a new template
  templateCache.data = [];
  templateCache.expiresAt = 0;

  structuredLog(correlationId, "INFO", "Template submitted for approval", {
    name: requestBody.name,
    metaResponse: responseBody,
  });

  return new Response(
    JSON.stringify({
      success: true,
      message: `Template "${requestBody.name}" submitted for approval. Status will be PENDING until Meta reviews it.`,
      template_id: responseBody.id ?? null,
      status: "PENDING",
      correlation_id: correlationId,
    }),
    {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    }
  );
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const correlationId = generateCorrelationId();

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders() });
  }

  // ── JWT Verification (for all routes) ──────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    structuredLog(correlationId, "WARN", "Missing or invalid authorization header");
    return new Response(
      JSON.stringify({ error: "Missing or invalid authorization header" }),
      {
        status: 401,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const token = authHeader.slice(7);
  const jwtSecret =
    Deno.env.get("SUPABASE_JWT_SECRET") ?? Deno.env.get("JWT_SECRET");

  if (!jwtSecret) {
    structuredLog(correlationId, "ERROR", "JWT secret not configured");
    return new Response(
      JSON.stringify({ error: "Server misconfigured: JWT secret not available" }),
      {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  let payload: JwtPayload;
  try {
    payload = verifyJwt(token, jwtSecret);
  } catch (jwtErr) {
    structuredLog(correlationId, "WARN", "JWT verification failed", {
      error: jwtErr instanceof Error ? jwtErr.message : String(jwtErr),
    });
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      {
        status: 401,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const userRole = payload.role ?? payload["app_metadata"]?.role;
  if (userRole !== "admin" && userRole !== "super_admin") {
    structuredLog(correlationId, "WARN", "Insufficient permissions", {
      userId: payload.sub,
      role: userRole,
    });
    return new Response(
      JSON.stringify({ error: "Forbidden: admin role required" }),
      {
        status: 403,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  structuredLog(correlationId, "INFO", "Request authenticated", {
    userId: payload.sub,
    role: userRole,
    method: req.method,
    url: req.url,
  });

  try {
    const url = new URL(req.url);

    // ── GET /templates — List templates ───────────────────────────────────
    if (req.method === "GET" && url.pathname.endsWith("/templates")) {
      return await handleListTemplates(correlationId);
    }

    // ── POST /create — Create template ────────────────────────────────────
    if (req.method === "POST" && url.pathname.endsWith("/create")) {
      let body: CreateTemplateRequest;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON in request body" }),
          {
            status: 400,
            headers: { ...corsHeaders(), "Content-Type": "application/json" },
          }
        );
      }
      return await handleCreateTemplate(correlationId, body);
    }

    // ── No matching route ────────────────────────────────────────────────
    structuredLog(correlationId, "WARN", "No matching route", {
      method: req.method,
      pathname: url.pathname,
    });
    return new Response(
      JSON.stringify({
        error: "Route not found. Available routes: GET /templates, POST /create",
      }),
      {
        status: 404,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    structuredLog(correlationId, "ERROR", "Unhandled exception", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        correlation_id: correlationId,
      }),
      {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }
});
