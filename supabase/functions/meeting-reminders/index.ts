// Supabase Edge Function: Meeting Reminders
// Sends reminders for upcoming meetings via WhatsApp and in-app notifications.
// Deno runtime with npm: imports
//
// KNOWN RISK (found during repo-sync read-through, not yet fixed): the query
// below joins leads:lead_id(id, phone, full_name, email). Earlier in this
// same repo-sync session, direct inspection of the live `leads` table schema
// showed contact_phone/contact_name as the actual column names, not
// phone/full_name. If that schema still holds, this join would silently
// return null for lead_phone/lead_name on every meeting, and every WhatsApp
// reminder would skip with "No phone number on lead" even when the lead has
// one. Not re-verified live in this pass — flagging as a real risk to check,
// not assuming it's broken or that it works.

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

interface MeetingReminderRow {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  consultant_id: string;
  lead_id?: string;
  status: string;
  reminder_sent: boolean;
  // Joined from leads table
  lead_phone?: string;
  lead_name?: string;
  lead_email?: string;
  // Joined from consultants table
  consultant_name?: string;
  consultant_phone?: string;
}

interface SendReminderRequest {
  hours_ahead?: number;
}

interface ReminderResult {
  reminded: number;
  failed: number;
  results: Array<{
    meeting_id: string;
    lead_name?: string;
    lead_phone?: string;
    in_app: boolean;
    whatsapp: boolean;
    whatsapp_error?: string;
    error?: string;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCorrelationId(): string {
  return `mtg-remind-${crypto.randomUUID().slice(0, 8)}`;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    function: "meeting-reminders",
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

/**
 * Format an ISO date string for human-readable display in India timezone.
 */
function formatMeetingTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Send a WhatsApp message by calling the whatsapp-send edge function internally.
 * This is a graceful attempt — failures are caught and logged, never thrown.
 */
async function attemptWhatsAppReminder(
  supabaseUrl: string,
  supabaseServiceKey: string,
  correlationId: string,
  phone: string,
  leadName: string | undefined,
  meetingTitle: string,
  meetingTime: string,
  consultantName: string | undefined,
  leadId: string | undefined,
  brandId: string | undefined
): Promise<{ success: boolean; error?: string }> {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    structuredLog(
      correlationId,
      "WARN",
      "WhatsApp credentials not configured, skipping WhatsApp reminder",
      {
        hasAccessToken: !!WHATSAPP_ACCESS_TOKEN,
        hasPhoneNumberId: !!WHATSAPP_PHONE_NUMBER_ID,
      }
    );
    return {
      success: false,
      error:
        "WhatsApp not configured",
    };
  }

  // Build the reminder message text
  const namePart = leadName ? `Hi ${leadName}` : "Hello";
  const consultantPart = consultantName
    ? ` with ${consultantName}`
    : "";
  const message = `${namePart}, a friendly reminder: your meeting"${meetingTitle}"${consultantPart} is scheduled for ${meetingTime}. Please be ready 5 minutes before. Reply to confirm or reschedule.`;

  try {
    // Call the Meta Graph API directly (same as whatsapp-send would do)
    const recipientPhone = phone.replace(/[\s\-()]/g, "");
    const metaApiUrl = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const metaResponse = await fetch(metaApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "text",
        text: {
          preview_url: false,
          body: message,
        },
      }),
    });

    const metaBody = await metaResponse.json();

    if (!metaResponse.ok) {
      structuredLog(correlationId, "WARN", "WhatsApp reminder API error", {
        status: metaResponse.status,
        error: metaBody.error?.message,
        phone: recipientPhone,
      });
      return {
        success: false,
        error: metaBody.error?.message ?? `HTTP ${metaResponse.status}`,
      };
    }

    const whatsappMessageId = metaBody.messages?.[0]?.id;

    structuredLog(correlationId, "INFO", "WhatsApp reminder sent", {
      whatsappMessageId,
      phone: recipientPhone,
    });

    // Log the outbound message
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const logRecord = {
      phone_number: recipientPhone,
      message_type: "text",
      body_text: message,
      whatsapp_message_id: whatsappMessageId ?? null,
      lead_id: leadId ?? null,
      brand_id: brandId ?? null,
      sent_by: "system",
      status: "sent",
      direction: "outbound",
      correlation_id: correlationId,
      metadata: { purpose: "meeting_reminder" },
      created_at: new Date().toISOString(),
    };

    // Try whatsapp_outbound_log first, fall back to agent_dispatch_log
    const { error: logError1 } = await supabase
      .from("whatsapp_outbound_log")
      .insert(logRecord);

    if (logError1) {
      await supabase
        .from("agent_dispatch_log")
        .insert({
          lead_id: leadId ?? null,
          channel: "whatsapp",
          direction: "outbound",
          message_content: message.substring(0, 500),
          external_message_id: whatsappMessageId ?? null,
          status: "sent",
          metadata: logRecord.metadata,
          created_at: new Date().toISOString(),
        })
        .catch(() => {
          /* non-fatal */
        });
    }

    return { success: true };
  } catch (err) {
    structuredLog(correlationId, "WARN", "WhatsApp reminder attempt failed", {
      error: err instanceof Error ? err.message : String(err),
      phone,
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Create an in-app notification for a meeting reminder.
 */
async function createInAppNotification(
  supabase: ReturnType<typeof createClient>,
  correlationId: string,
  meeting: MeetingReminderRow
): Promise<boolean> {
  const notification = {
    user_id: meeting.consultant_id,
    title: "Upcoming Meeting Reminder",
    body: `Meeting "${meeting.title}" is scheduled for ${formatMeetingTime(meeting.start_time)}${meeting.lead_name ? ` with ${meeting.lead_name}` : ""}.`,
    type: "meeting_reminder",
    reference_id: meeting.id,
    reference_table: "meetings",
    metadata: {
      meeting_id: meeting.id,
      lead_id: meeting.lead_id ?? null,
      start_time: meeting.start_time,
      lead_name: meeting.lead_name ?? null,
      lead_phone: meeting.lead_phone ?? null,
    },
    is_read: false,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("notifications")
    .insert(notification);

  if (error) {
    structuredLog(correlationId, "WARN", "Failed to create in-app notification", {
      error: error.message,
      meetingId: meeting.id,
    });
    return false;
  }

  structuredLog(correlationId, "INFO", "In-app notification created", {
    meetingId: meeting.id,
    consultantId: meeting.consultant_id,
  });

  return true;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const correlationId = generateCorrelationId();

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    structuredLog(correlationId, "WARN", "Method not allowed", {
      method: req.method,
    });
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // ── JWT Verification ───────────────────────────────────────────────────
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

  let jwtPayload: JwtPayload;
  try {
    jwtPayload = verifyJwt(token, jwtSecret);
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

  // Allow system-level calls (service role) or admin/consultant
  const userRole = jwtPayload.role ?? jwtPayload["app_metadata"]?.role;
  const allowedRoles = ["admin", "super_admin", "consultant", "service_role"];
  if (!allowedRoles.includes(userRole as string)) {
    structuredLog(correlationId, "WARN", "Insufficient permissions", {
      userId: jwtPayload.sub,
      role: userRole,
    });
    return new Response(
      JSON.stringify({ error: "Forbidden: admin, super_admin, consultant, or service_role required" }),
      {
        status: 403,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  structuredLog(correlationId, "INFO", "Request authenticated", {
    userId: jwtPayload.sub,
    role: userRole,
  });

  // ── Initialize Supabase client ─────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    structuredLog(correlationId, "ERROR", "Supabase credentials not configured");
    return new Response(
      JSON.stringify({ error: "Server misconfigured: Supabase credentials not available" }),
      {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  try {
    const url = new URL(req.url);

    // ── Route: /send ─────────────────────────────────────────────────────
    if (url.pathname.endsWith("/send")) {
      let body: SendReminderRequest;
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

      const hoursAhead = body.hours_ahead ?? 24;
      if (typeof hoursAhead !== "number" || hoursAhead <= 0 || hoursAhead > 168) {
        return new Response(
          JSON.stringify({
            error: "hours_ahead must be a number between 1 and 168 (1 week)",
          }),
          {
            status: 400,
            headers: { ...corsHeaders(), "Content-Type": "application/json" },
          }
        );
      }

      // Calculate the time window
      const now = new Date();
      const windowEnd = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

      structuredLog(correlationId, "INFO", "Scanning for upcoming meetings", {
        hoursAhead,
        windowStart: now.toISOString(),
        windowEnd: windowEnd.toISOString(),
      });

      // Query meetings in the time window that haven't had reminders sent
      // Join with leads to get phone/name, and consultants to get consultant name
      const { data: meetings, error: queryError } = await supabase
        .from("meetings")
        .select(`
          id,
          title,
          description,
          start_time,
          end_time,
          consultant_id,
          lead_id,
          status,
          reminder_sent,
          leads:lead_id (
            id,
            phone,
            full_name,
            email
          ),
          consultants:consultant_id (
            id,
            full_name,
            phone
          ),
          brands:brand_id (
            id,
            name
          )
        `)
        .eq("reminder_sent", false)
        .eq("status", "confirmed")
        .gte("start_time", now.toISOString())
        .lte("start_time", windowEnd.toISOString())
        .order("start_time", { ascending: true })
        .limit(100);

      if (queryError) {
        structuredLog(correlationId, "ERROR", "Failed to query meetings", {
          error: queryError.message,
          code: queryError.code,
        });
        return new Response(
          JSON.stringify({
            error: `Database query failed: ${queryError.message}`,
          }),
          {
            status: 500,
            headers: { ...corsHeaders(), "Content-Type": "application/json" },
          }
        );
      }

      if (!meetings || meetings.length === 0) {
        structuredLog(correlationId, "INFO", "No meetings found in the reminder window");
        return new Response(
          JSON.stringify({
            reminded: 0,
            failed: 0,
            results: [],
            message: "No upcoming meetings found requiring reminders",
            correlation_id: correlationId,
          }),
          {
            status: 200,
            headers: { ...corsHeaders(), "Content-Type": "application/json" },
          }
        );
      }

      structuredLog(correlationId, "INFO", `Found ${meetings.length} meetings to remind`, {
        count: meetings.length,
      });

      const results: ReminderResult["results"] = [];
      let remindedCount = 0;
      let failedCount = 0;

      // Process each meeting
      for (const meeting of meetings) {
        const meetingData = meeting as unknown as Record<string, unknown>;
        const leadData = meetingData.leads as Record<string, unknown> | null;
        const consultantData = meetingData.consultants as Record<string, unknown> | null;
        const brandData = meetingData.brands as Record<string, unknown> | null;

        const leadPhone = (leadData?.phone as string) ?? undefined;
        const leadName = (leadData?.full_name as string) ?? undefined;
        const consultantName = (consultantData?.full_name as string) ?? undefined;
        const brandId = (brandData?.id as string) ?? undefined;

        const result: ReminderResult["results"][0] = {
          meeting_id: meeting.id,
          lead_name: leadName,
          lead_phone: leadPhone,
          in_app: false,
          whatsapp: false,
        };

        // Step 1: Create in-app notification
        try {
          const inAppCreated = await createInAppNotification(
            supabase,
            correlationId,
            {
              ...meeting,
              lead_phone: leadPhone,
              lead_name: leadName,
              consultant_name: consultantName,
            } as MeetingReminderRow
          );
          result.in_app = inAppCreated;
        } catch (inAppErr) {
          structuredLog(correlationId, "WARN", "In-app notification failed for meeting", {
            meetingId: meeting.id,
            error: inAppErr instanceof Error ? inAppErr.message : String(inAppErr),
          });
        }

        // Step 2: Attempt WhatsApp reminder (graceful — never blocks)
        if (leadPhone) {
          const whatsappResult = await attemptWhatsAppReminder(
            supabaseUrl,
            supabaseServiceKey,
            correlationId,
            leadPhone,
            leadName,
            meeting.title,
            formatMeetingTime(meeting.start_time),
            consultantName,
            meeting.lead_id ?? undefined,
            brandId
          );
          result.whatsapp = whatsappResult.success;
          result.whatsapp_error = whatsappResult.error;
        } else {
          result.whatsapp_error = "No phone number on lead";
          structuredLog(correlationId, "WARN", "No phone number for lead, skipping WhatsApp", {
            meetingId: meeting.id,
            leadId: meeting.lead_id,
          });
        }

        // Step 3: Mark reminder_sent = true (best-effort)
        const { error: updateError } = await supabase
          .from("meetings")
          .update({
            reminder_sent: true,
            reminder_sent_at: new Date().toISOString(),
            reminder_status: result.in_app || result.whatsapp ? "sent" : "partial",
          })
          .eq("id", meeting.id);

        if (updateError) {
          structuredLog(correlationId, "WARN", "Failed to mark reminder_sent", {
            meetingId: meeting.id,
            error: updateError.message,
          });
          // Still count as success if notifications were sent
        }

        // Determine overall result
        if (result.in_app || result.whatsapp) {
          remindedCount++;
        } else {
          failedCount++;
          result.error = "Both in-app and WhatsApp reminders failed";
        }

        results.push(result);
      }

      structuredLog(correlationId, "INFO", "Reminder processing complete", {
        total: meetings.length,
        reminded: remindedCount,
        failed: failedCount,
      });

      return new Response(
        JSON.stringify({
          reminded: remindedCount,
          failed: failedCount,
          results,
          correlation_id: correlationId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    // ── No matching route ────────────────────────────────────────────────
    structuredLog(correlationId, "WARN", "No matching route", {
      pathname: new URL(req.url).pathname,
    });
    return new Response(
      JSON.stringify({
        error: "Route not found. Available routes: POST /send",
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
