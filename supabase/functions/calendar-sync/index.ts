// Supabase Edge Function: Google Calendar OAuth + Sync
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

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface GoogleCalendarEvent {
  id?: string;
  htmlLink?: string;
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  attendees?: Array<{ email: string; responseStatus?: string }>;
  conferenceData?: {
    createRequest?: {
      requestId: string;
      conferenceSolutionKey?: { type: string };
    };
  };
}

interface StoredCalendarTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

interface MeetingRow {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  consultant_id: string;
  lead_id?: string;
  google_calendar_event_id?: string;
  status: string;
}

// ─── Google OAuth Constants ──────────────────────────────────────────────────

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCorrelationId(): string {
  return `cal-sync-${crypto.randomUUID().slice(0, 8)}`;
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
    function: "calendar-sync",
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

function verifyGoogleCredentials(correlationId: string): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    structuredLog(correlationId, "ERROR", "Google OAuth credentials missing", {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
    });
    throw new Error(
      "Calendar sync failed: Google OAuth credentials not configured. Founder action: Google Cloud Console → APIs & Services → Create OAuth 2.0 credentials → Enable Calendar API → Configure OAuth consent screen."
    );
  }

  return { clientId, clientSecret };
}

/**
 * Refresh an expired Google access token using the refresh token.
 */
async function refreshGoogleToken(
  refreshToken: string,
  correlationId: string
): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = verifyGoogleCredentials(correlationId);

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body: GoogleTokenResponse = await response.json();

  if (!response.ok || body.error) {
    throw new Error(
      `Google token refresh failed: ${body.error_description ?? body.error ?? `HTTP ${response.status}`}`
    );
  }

  return {
    access_token: body.access_token,
    expires_in: body.expires_in,
  };
}

/**
 * Get a valid Google access token, refreshing if needed.
 * Also updates the stored tokens in the database if refreshed.
 */
async function getValidAccessToken(
  supabase: ReturnType<typeof createClient>,
  consultantId: string,
  correlationId: string
): Promise<{ accessToken: string; tokens: StoredCalendarTokens }> {
  // Fetch stored tokens
  const { data: consultant, error: fetchError } = await supabase
    .from("consultants")
    .select("id, google_calendar_tokens")
    .eq("id", consultantId)
    .single();

  if (fetchError || !consultant) {
    throw new Error(
      `Consultant not found or missing calendar tokens: ${fetchError?.message ?? "not found"}`
    );
  }

  const tokens = consultant.google_calendar_tokens as StoredCalendarTokens | null;

  if (!tokens || !tokens.refresh_token) {
    throw new Error(
      "No Google Calendar tokens stored for this consultant. Please complete OAuth flow first."
    );
  }

  // Check if access token is still valid (with 60-second buffer)
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at && tokens.expires_at > now + 60) {
    return { accessToken: tokens.access_token, tokens };
  }

  // Token is expired or about to expire — refresh
  structuredLog(correlationId, "INFO", "Refreshing Google access token", {
    consultantId,
  });

  const { access_token, expires_in } = await refreshGoogleToken(
    tokens.refresh_token,
    correlationId
  );

  const updatedTokens: StoredCalendarTokens = {
    ...tokens,
    access_token,
    expires_at: now + expires_in,
  };

  // Update stored tokens
  const { error: updateError } = await supabase
    .from("consultants")
    .update({ google_calendar_tokens: updatedTokens })
    .eq("id", consultantId);

  if (updateError) {
    structuredLog(correlationId, "WARN", "Failed to update stored tokens", {
      error: updateError.message,
    });
    // Non-fatal — we can still use the fresh token for this request
  }

  return { accessToken: access_token, tokens: updatedTokens };
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/**
 * POST /calendar-sync/auth-url — Generate Google OAuth URL
 */
async function handleAuthUrl(
  correlationId: string,
  requestBody: { redirect_uri: string; consultant_id: string }
): Promise<Response> {
  const { clientId } = verifyGoogleCredentials(correlationId);

  if (!requestBody.redirect_uri || !requestBody.consultant_id) {
    return new Response(
      JSON.stringify({
        error: "Missing required fields: redirect_uri, consultant_id",
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Validate consultant_id is a UUID
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(requestBody.consultant_id)) {
    return new Response(
      JSON.stringify({ error: "consultant_id must be a valid UUID" }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Encode consultant_id in the state parameter for callback identification
  const state = btoa(
    JSON.stringify({
      consultant_id: requestBody.consultant_id,
      ts: Date.now(),
    })
  );

  const authUrl = new URL(GOOGLE_AUTH_BASE);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", requestBody.redirect_uri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", CALENDAR_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent"); // Force refresh token
  authUrl.searchParams.set("state", state);

  structuredLog(correlationId, "INFO", "Generated OAuth URL", {
    consultantId: requestBody.consultant_id,
    redirectUri: requestBody.redirect_uri,
  });

  return new Response(
    JSON.stringify({
      auth_url: authUrl.toString(),
      state,
      correlation_id: correlationId,
    }),
    {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    }
  );
}

/**
 * POST /calendar-sync/callback — Handle OAuth callback
 */
async function handleCallback(
  correlationId: string,
  requestBody: { code: string; redirect_uri: string; state: string },
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const { clientId, clientSecret } = verifyGoogleCredentials(correlationId);

  if (!requestBody.code || !requestBody.redirect_uri || !requestBody.state) {
    return new Response(
      JSON.stringify({
        error: "Missing required fields: code, redirect_uri, state",
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Decode state to get consultant_id
  let consultantId: string;
  try {
    const statePayload = JSON.parse(atob(requestBody.state));
    consultantId = statePayload.consultant_id;
    if (!consultantId) throw new Error("No consultant_id in state");
  } catch (decodeErr) {
    return new Response(
      JSON.stringify({
        error: `Invalid state parameter: ${decodeErr instanceof Error ? decodeErr.message : "decode failed"}`,
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Exchange code for tokens
  structuredLog(correlationId, "INFO", "Exchanging code for tokens", {
    consultantId,
  });

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: requestBody.code,
      redirect_uri: requestBody.redirect_uri,
      grant_type: "authorization_code",
    }),
  });

  const tokenBody: GoogleTokenResponse = await tokenResponse.json();

  if (!tokenResponse.ok || tokenBody.error) {
    structuredLog(correlationId, "ERROR", "Token exchange failed", {
      error: tokenBody.error,
      description: tokenBody.error_description,
    });
    return new Response(
      JSON.stringify({
        error: `Token exchange failed: ${tokenBody.error_description ?? tokenBody.error ?? `HTTP ${tokenResponse.status}`}`,
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  if (!tokenBody.refresh_token) {
    structuredLog(correlationId, "WARN", "No refresh_token returned", {
      consultantId,
    });
    return new Response(
      JSON.stringify({
        error:
          "Google did not return a refresh_token. This can happen if the user has already authorized the app and the consent screen was not re-shown. Try revoking access in Google Account settings and re-authorizing.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const tokens: StoredCalendarTokens = {
    access_token: tokenBody.access_token,
    refresh_token: tokenBody.refresh_token,
    expires_at: now + tokenBody.expires_in,
    scope: tokenBody.scope,
  };

  // Store tokens in consultants table
  const { error: updateError } = await supabase
    .from("consultants")
    .update({ google_calendar_tokens: tokens })
    .eq("id", consultantId);

  if (updateError) {
    structuredLog(correlationId, "ERROR", "Failed to store tokens", {
      error: updateError.message,
      consultantId,
    });
    return new Response(
      JSON.stringify({
        error: `Failed to store Google Calendar tokens: ${updateError.message}`,
      }),
      {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  structuredLog(correlationId, "INFO", "Google Calendar tokens stored", {
    consultantId,
  });

  return new Response(
    JSON.stringify({
      success: true,
      message: "Google Calendar connected successfully",
      consultant_id: consultantId,
      correlation_id: correlationId,
    }),
    {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    }
  );
}

/**
 * POST /calendar-sync/create-event — Create a Google Calendar event
 */
async function handleCreateEvent(
  correlationId: string,
  requestBody: {
    consultant_id: string;
    summary: string;
    description?: string;
    start_time: string;
    end_time: string;
    attendees?: string[];
    lead_id?: string;
    meeting_id?: string;
  },
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  // Validate required fields
  if (
    !requestBody.consultant_id ||
    !requestBody.summary ||
    !requestBody.start_time ||
    !requestBody.end_time
  ) {
    return new Response(
      JSON.stringify({
        error:
          "Missing required fields: consultant_id, summary, start_time, end_time",
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Validate ISO8601 dates
  const startTime = new Date(requestBody.start_time);
  const endTime = new Date(requestBody.end_time);

  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    return new Response(
      JSON.stringify({
        error:
          "Invalid start_time or end_time. Must be valid ISO8601 strings.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  if (endTime <= startTime) {
    return new Response(
      JSON.stringify({
        error: "end_time must be after start_time",
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Get valid access token
  let accessToken: string;
  try {
    const result = await getValidAccessToken(
      supabase,
      requestBody.consultant_id,
      correlationId
    );
    accessToken = result.accessToken;
  } catch (tokenErr) {
    const msg =
      tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    structuredLog(correlationId, "ERROR", "Failed to get access token", {
      error: msg,
    });
    return new Response(
      JSON.stringify({ error: msg }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Build the calendar event
  const event: GoogleCalendarEvent = {
    summary: requestBody.summary,
    description: requestBody.description,
    start: {
      dateTime: requestBody.start_time,
      timeZone: "Asia/Kolkata",
    },
    end: {
      dateTime: requestBody.end_time,
      timeZone: "Asia/Kolkata",
    },
    attendees: requestBody.attendees?.map((email) => ({
      email,
    })),
    conferenceData: {
      createRequest: {
        requestId: `fkaios-${crypto.randomUUID().slice(0, 12)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  structuredLog(correlationId, "INFO", "Creating Google Calendar event", {
    summary: requestBody.summary,
    startTime: requestBody.start_time,
    endTime: requestBody.end_time,
    meetingId: requestBody.meeting_id ?? null,
  });

  // Create the event via Google Calendar API
  const calendarResponse = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  const calendarBody = await calendarResponse.json();

  if (!calendarResponse.ok) {
    structuredLog(correlationId, "ERROR", "Google Calendar API error", {
      status: calendarResponse.status,
      error: calendarBody,
    });
    return new Response(
      JSON.stringify({
        error: `Google Calendar API error: ${calendarBody.error?.message ?? JSON.stringify(calendarBody)}`,
      }),
      {
        status: calendarResponse.status >= 500 ? 502 : 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const eventId = calendarBody.id;
  const htmlLink = calendarBody.htmlLink;

  structuredLog(correlationId, "INFO", "Calendar event created", {
    eventId,
    htmlLink,
  });

  // Store the google_calendar_event_id back in meetings table if meeting_id provided
  if (requestBody.meeting_id && eventId) {
    const { error: meetingUpdateError } = await supabase
      .from("meetings")
      .update({
        google_calendar_event_id: eventId,
        google_calendar_link: htmlLink,
      })
      .eq("id", requestBody.meeting_id);

    if (meetingUpdateError) {
      structuredLog(correlationId, "WARN", "Failed to update meeting with calendar event ID", {
        error: meetingUpdateError.message,
        meetingId: requestBody.meeting_id,
      });
      // Non-fatal — the event was still created
    } else {
      structuredLog(correlationId, "INFO", "Meeting updated with calendar event ID", {
        meetingId: requestBody.meeting_id,
        calendarEventId: eventId,
      });
    }
  }

  return new Response(
    JSON.stringify({
      event_id: eventId,
      html_link: htmlLink,
      meet_link: calendarBody.conferenceData?.entryPoints?.[0]?.uri ?? null,
      correlation_id: correlationId,
    }),
    {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    }
  );
}

/**
 * POST /calendar-sync/sync-meeting — Sync a meeting from FKAIOS to Google Calendar
 */
async function handleSyncMeeting(
  correlationId: string,
  requestBody: { meeting_id: string; consultant_id: string },
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  if (!requestBody.meeting_id || !requestBody.consultant_id) {
    return new Response(
      JSON.stringify({
        error: "Missing required fields: meeting_id, consultant_id",
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Look up the meeting
  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", requestBody.meeting_id)
    .single();

  if (meetingError || !meeting) {
    return new Response(
      JSON.stringify({
        error: `Meeting not found: ${meetingError?.message ?? "no record"}`,
      }),
      {
        status: 404,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const typedMeeting = meeting as unknown as MeetingRow;

  // If the meeting already has a Google Calendar event, update it instead
  if (typedMeeting.google_calendar_event_id) {
    return handleUpdateEvent(
      correlationId,
      typedMeeting,
      requestBody.consultant_id,
      supabase
    );
  }

  // Otherwise, create a new event
  structuredLog(correlationId, "INFO", "Syncing meeting to new Google Calendar event", {
    meetingId: requestBody.meeting_id,
    title: typedMeeting.title,
  });

  return handleCreateEvent(
    correlationId,
    {
      consultant_id: requestBody.consultant_id,
      summary: typedMeeting.title,
      description: typedMeeting.description,
      start_time: typedMeeting.start_time,
      end_time: typedMeeting.end_time,
      lead_id: typedMeeting.lead_id,
      meeting_id: typedMeeting.id,
    },
    supabase
  );
}

/**
 * Update an existing Google Calendar event.
 */
async function handleUpdateEvent(
  correlationId: string,
  meeting: MeetingRow,
  consultantId: string,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  // Get valid access token
  let accessToken: string;
  try {
    const result = await getValidAccessToken(
      supabase,
      consultantId,
      correlationId
    );
    accessToken = result.accessToken;
  } catch (tokenErr) {
    const msg =
      tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    return new Response(
      JSON.stringify({ error: msg }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  const event: GoogleCalendarEvent = {
    summary: meeting.title,
    description: meeting.description,
    start: {
      dateTime: meeting.start_time,
      timeZone: "Asia/Kolkata",
    },
    end: {
      dateTime: meeting.end_time,
      timeZone: "Asia/Kolkata",
    },
  };

  structuredLog(correlationId, "INFO", "Updating existing Google Calendar event", {
    meetingId: meeting.id,
    calendarEventId: meeting.google_calendar_event_id,
  });

  const calendarResponse = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${meeting.google_calendar_event_id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  const calendarBody = await calendarResponse.json();

  if (!calendarResponse.ok) {
    structuredLog(correlationId, "ERROR", "Google Calendar update failed", {
      status: calendarResponse.status,
      error: calendarBody,
    });
    return new Response(
      JSON.stringify({
        error: `Google Calendar update failed: ${calendarBody.error?.message ?? JSON.stringify(calendarBody)}`,
      }),
      {
        status: calendarResponse.status >= 500 ? 502 : 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Update the meeting's Google Calendar link
  if (calendarBody.htmlLink) {
    await supabase
      .from("meetings")
      .update({ google_calendar_link: calendarBody.htmlLink })
      .eq("id", meeting.id);
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: "updated",
      event_id: meeting.google_calendar_event_id,
      html_link: calendarBody.htmlLink,
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
  if (userRole !== "admin" && userRole !== "super_admin" && userRole !== "consultant") {
    structuredLog(correlationId, "WARN", "Insufficient permissions", {
      userId: payload.sub,
      role: userRole,
    });
    return new Response(
      JSON.stringify({ error: "Forbidden: admin, super_admin, or consultant role required" }),
      {
        status: 403,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  structuredLog(correlationId, "INFO", "Request authenticated", {
    userId: payload.sub,
    role: userRole,
    url: req.url,
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
    let body: Record<string, unknown>;

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

    // ── Route: /auth-url ─────────────────────────────────────────────────
    if (url.pathname.endsWith("/auth-url")) {
      return handleAuthUrl(correlationId, {
        redirect_uri: body.redirect_uri as string,
        consultant_id: body.consultant_id as string,
      });
    }

    // ── Route: /callback ─────────────────────────────────────────────────
    if (url.pathname.endsWith("/callback")) {
      return handleCallback(
        correlationId,
        {
          code: body.code as string,
          redirect_uri: body.redirect_uri as string,
          state: body.state as string,
        },
        supabase
      );
    }

    // ── Route: /create-event ─────────────────────────────────────────────
    if (url.pathname.endsWith("/create-event")) {
      return handleCreateEvent(
        correlationId,
        {
          consultant_id: body.consultant_id as string,
          summary: body.summary as string,
          description: body.description as string | undefined,
          start_time: body.start_time as string,
          end_time: body.end_time as string,
          attendees: body.attendees as string[] | undefined,
          lead_id: body.lead_id as string | undefined,
          meeting_id: body.meeting_id as string | undefined,
        },
        supabase
      );
    }

    // ── Route: /sync-meeting ─────────────────────────────────────────────
    if (url.pathname.endsWith("/sync-meeting")) {
      return handleSyncMeeting(
        correlationId,
        {
          meeting_id: body.meeting_id as string,
          consultant_id: body.consultant_id as string,
        },
        supabase
      );
    }

    // ── No matching route ────────────────────────────────────────────────
    structuredLog(correlationId, "WARN", "No matching route", {
      pathname: url.pathname,
    });
    return new Response(
      JSON.stringify({
        error:
          "Route not found. Available routes: POST /auth-url, /callback, /create-event, /sync-meeting",
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

    // Check if the error is our honesty protocol message
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (
      errorMessage.includes("Google OAuth credentials not configured") ||
      errorMessage.includes("Founder action")
    ) {
      return new Response(
        JSON.stringify({ error: errorMessage }),
        {
          status: 503,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

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
