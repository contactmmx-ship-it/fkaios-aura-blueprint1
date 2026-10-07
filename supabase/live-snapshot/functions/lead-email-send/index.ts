// Supabase Edge Function: Lead Email Sender (Resend)
// Smallest possible real outbound-email path for a single lead contact
// attempt. Mirrors whatsapp-send's auth + honesty-protocol pattern:
// admin-only, fails closed (never fakes success) if RESEND_API_KEY is
// missing or the provider call errors, and logs one real lead_activities
// row only on a confirmed send.
//
// Required Edge Function secret: RESEND_API_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";

interface JwtPayload {
  sub: string;
  role: string;
  aud: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

interface SendEmailRequest {
  to_email: string;
  subject: string;
  body_html?: string;
  body_text?: string;
  from_email?: string;
  lead_id?: string;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function generateCorrelationId(): string {
  return `email-send-${crypto.randomUUID().slice(0, 8)}`;
}

function structuredLog(
  correlationId: string,
  level: string,
  message: string,
  data?: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      correlationId,
      level,
      message,
      ...(data && { data }),
    })
  );
}

function verifyJwt(token: string, jwtSecret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format: expected 3 parts");

  const headerB64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
  const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const signatureB64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");

  const header = JSON.parse(atob(headerB64));
  if (header.alg !== "HS256") throw new Error(`Unsupported JWT algorithm: ${header.alg}`);

  const signingInput = `${parts[0]}.${parts[1]}`;
  const expectedSignature = createHmac("sha256", jwtSecret)
    .update(signingInput)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const sigBuffer = Buffer.from(signatureB64, "base64");
  const expectedBuffer = Buffer.from(expectedSignature, "base64");
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new Error("JWT signature verification failed");
  }

  const payload = JSON.parse(atob(payloadB64));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("JWT has expired");
  if (payload.aud !== "authenticated") {
    throw new Error(`Invalid JWT audience: expected "authenticated", got "${payload.aud}"`);
  }
  return payload as JwtPayload;
}

function validateEmail(email: string): string {
  const trimmed = (email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error(`Invalid email address: "${email}"`);
  }
  return trimmed;
}

Deno.serve(async (req: Request) => {
  const correlationId = generateCorrelationId();

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  try {
    // ── 1. Auth: admin-only, same as whatsapp-send ──────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid authorization header" }), {
        status: 401,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const token = authHeader.slice(7);
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET") ?? Deno.env.get("JWT_SECRET");
    if (!jwtSecret) {
      return new Response(JSON.stringify({ error: "Server misconfigured: JWT secret not available" }), {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    let payload: JwtPayload;
    try {
      payload = verifyJwt(token, jwtSecret);
    } catch (jwtErr) {
      structuredLog(correlationId, "WARN", "JWT verification failed", {
        error: jwtErr instanceof Error ? jwtErr.message : String(jwtErr),
      });
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const userRole = payload.role ?? payload["app_metadata"]?.role;
    if (userRole !== "admin" && userRole !== "super_admin") {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    // ── 2. Parse + validate body ────────────────────────────────────
    let body: SendEmailRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    if (!body.to_email || !body.subject || (!body.body_html && !body.body_text)) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: to_email, subject, and one of body_html/body_text",
        }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    let toEmail: string;
    try {
      toEmail = validateEmail(body.to_email);
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Invalid email" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const fromEmail = body.from_email?.trim() || "billing@franchisekart.ai";

    // ── 3. Verify Resend credentials — HONESTY PROTOCOL ─────────────────
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      const errorMsg =
        "Email send failed: RESEND_API_KEY not configured. Founder action: create a Resend API key, verify the sending domain, then set RESEND_API_KEY as an Edge Function secret.";
      structuredLog(correlationId, "ERROR", "Resend credentials missing", {});
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 503,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    // ── 4. Call Resend ────────────────────────────────────────────
    structuredLog(correlationId, "INFO", "Sending email", {
      to: toEmail,
      from: fromEmail,
      leadId: body.lead_id ?? null,
    });

    let resendResponse: Response;
    try {
      resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: toEmail,
          subject: body.subject,
          html: body.body_html ?? undefined,
          text: body.body_text ?? undefined,
        }),
      });
    } catch (fetchErr) {
      structuredLog(correlationId, "ERROR", "Resend fetch failed", {
        error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
      });
      return new Response(
        JSON.stringify({
          error: `Failed to reach Resend API: ${fetchErr instanceof Error ? fetchErr.message : "Network error"}`,
        }),
        { status: 502, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const resendBody = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      structuredLog(correlationId, "ERROR", "Resend API returned error", {
        status: resendResponse.status,
        body: resendBody,
      });
      return new Response(
        JSON.stringify({
          error: `Resend API error: ${resendBody?.message ?? resendResponse.status}`,
          resend_response: resendBody,
        }),
        { status: resendResponse.status >= 500 ? 502 : 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    const resendMessageId = resendBody?.id;
    if (!resendMessageId) {
      structuredLog(correlationId, "ERROR", "No message ID in Resend response", { resendBody });
      return new Response(
        JSON.stringify({ error: "Resend did not return a message ID. Unexpected response format.", resend_response: resendBody }),
        { status: 502, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
      );
    }

    structuredLog(correlationId, "INFO", "Email sent successfully", { resendMessageId });

    // ── 5. Log the real contact attempt ──────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (supabaseUrl && supabaseServiceKey && body.lead_id) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      const { error: activityError } = await supabase.from("lead_activities").insert({
        lead_id: body.lead_id,
        activity_type: "email_outbound",
        description: `Email sent: ${body.subject}`,
        notes: JSON.stringify({
          resend_message_id: resendMessageId,
          to_email: toEmail,
          from_email: fromEmail,
          correlation_id: correlationId,
        }),
        created_by: payload.sub,
      });

      if (activityError) {
        structuredLog(correlationId, "ERROR", "lead_activities insert failed", {
          error: activityError.message,
          leadId: body.lead_id,
        });
      } else {
        structuredLog(correlationId, "INFO", "Logged to lead_activities", { leadId: body.lead_id });
      }
    } else if (!body.lead_id) {
      structuredLog(correlationId, "WARN", "No lead_id provided — email sent but not logged to lead_activities");
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_id: resendMessageId,
        to: toEmail,
        correlation_id: correlationId,
      }),
      { status: 200, headers: { ...corsHeaders(), "Content-Type": "application/json" } }
    );
  } catch (err) {
    structuredLog(correlationId, "ERROR", "Unhandled exception", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ error: "Internal server error", correlation_id: correlationId }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
});
