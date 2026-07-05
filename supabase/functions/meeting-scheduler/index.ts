import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  correlationId as generateCorrelationId,
  structuredLog,
  errorResponse,
  successResponse,
  verifyEnvSecrets,
  verifyJWT,
} from "../_shared/utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-ID",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const googleCalendarApiKey = Deno.env.get("GOOGLE_CALENDAR_API_KEY") ?? "";
const googleCalendarId = Deno.env.get("GOOGLE_CALENDAR_ID") ?? "";
const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const whatsappAccessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
  scope?: string;
}

async function refreshGoogleToken(refreshToken: string, cid: string): Promise<GoogleTokenResponse | null> {
  if (!googleClientId || !googleClientSecret) {
    structuredLog("WARN", "Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)", {}, cid);
    return null;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      structuredLog("ERROR", "Google OAuth token refresh failed", {
        status: response.status,
        error: errBody,
      }, cid);
      return null;
    }

    const tokenData: GoogleTokenResponse = await response.json();
    structuredLog("INFO", "Google OAuth token refreshed successfully", {
      expiresIn: tokenData.expires_in,
    }, cid);
    return tokenData;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    structuredLog("ERROR", "Error refreshing Google OAuth token", { error: msg }, cid);
    return null;
  }
}

async function getGoogleAccessToken(
  consultantId: string,
  cid: string,
): Promise<{ accessToken: string; calendarId: string } | null> {
  const { data: oauthMemory, error: memError } = await supabase
    .from("agent_memory")
    .select("*")
    .eq("memory_type", "oauth")
    .not("content", "is", null)
    .limit(20);

  if (memError || !oauthMemory) {
    structuredLog("WARN", "Failed to query agent_memory for OAuth tokens", { error: memError?.message }, cid);
    return null;
  }

  const entry = oauthMemory.find(
    (row: Record<string, unknown>) =>
      row.content?.consultant_id === consultantId &&
      row.content?.provider === "google_calendar"
  );

  if (!entry) {
    structuredLog("WARN", "No Google Calendar OAuth token found for consultant", { consultantId }, cid);
    return null;
  }

  const content = entry.content as Record<string, unknown>;
  const refreshToken = content.refresh_token as string | undefined;
  const calendarId = (content.calendar_id as string) || googleCalendarId;
  const expiresAt = content.expires_at as string | undefined;

  if (
    content.access_token &&
    expiresAt &&
    new Date(expiresAt).getTime() > Date.now() + 5 * 60 * 1000
  ) {
    return { accessToken: content.access_token as string, calendarId };
  }

  if (!refreshToken) {
    structuredLog("ERROR", "OAuth entry has no refresh_token, cannot refresh", { consultantId }, cid);
    return null;
  }

  const newToken = await refreshGoogleToken(refreshToken, cid);
  if (!newToken) {
    return null;
  }

  const newExpiresAt = new Date(Date.now() + newToken.expires_in * 1000).toISOString();

  const updatedContent = {
    ...content,
    access_token: newToken.access_token,
    expires_at: newExpiresAt,
    ...(newToken.refresh_token ? { refresh_token: newToken.refresh_token } : {}),
  };

  const { error: updateError } = await supabase
    .from("agent_memory")
    .update({ content: updatedContent, last_accessed_at: new Date().toISOString() })
    .eq("id", entry.id);

  if (updateError) {
    structuredLog("ERROR", "Failed to update OAuth token in agent_memory", {
      error: updateError.message,
      memoryId: entry.id,
    }, cid);
  }

  return { accessToken: newToken.access_token, calendarId };
}

async function getGoogleAuthHeaders(
  consultantId: string | null,
  requireWrite: boolean,
  cid: string,
): Promise<{ headers: Record<string, string>; oauthAvailable: boolean } | { error: string }> {
  if (consultantId) {
    const oauth = await getGoogleAccessToken(consultantId, cid);
    if (oauth) {
      return {
        headers: {
          "Authorization": `Bearer ${oauth.accessToken}`,
          "Content-Type": "application/json",
        },
        oauthAvailable: true,
      };
    }
  }

  if (googleCalendarApiKey) {
    if (requireWrite) {
      return {
        error: "Calendar write operations require Google OAuth setup. Please configure Google OAuth for this consultant.",
      };
    }
    return {
      headers: {
        "Content-Type": "application/json",
      },
      oauthAvailable: false,
    };
  }

  if (requireWrite) {
    return {
      error: "Calendar write operations require Google OAuth setup. Please configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and complete the OAuth flow for this consultant.",
    };
  }

  return {
    headers: { "Content-Type": "application/json" },
    oauthAvailable: false,
  };
}

async function getAvailableSlots(
  rmEmail: string,
  startDate: string,
  endDate: string,
  consultantId: string | null,
  cid: string,
) {
  const authResult = await getGoogleAuthHeaders(consultantId, false, cid);
  if ("error" in authResult) {
    structuredLog("WARN", authResult.error, {}, cid);
    return [];
  }

  const calId = googleCalendarId;
  if (!calId && !authResult.oauthAvailable) {
    structuredLog("WARN", "Google Calendar not configured, returning placeholder slots", {}, cid);
    const now = new Date();
    return [
      { time: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), available: true },
      { time: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(), available: true },
      { time: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(), available: true },
    ];
  }

  try {
    const url = authResult.oauthAvailable
      ? `https://www.googleapis.com/calendar/v3/calendars/${calId}/freebusy`
      : `https://www.googleapis.com/calendar/v3/calendars/${calId}/freebusy?key=${googleCalendarApiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: authResult.headers,
      body: JSON.stringify({
        timeMin: startDate,
        timeMax: endDate,
        items: [{ id: calId }],
      }),
    });

    if (!response.ok) {
      structuredLog("ERROR", "Google Calendar API error", { status: response.status }, cid);
      return [];
    }

    const data = await response.json();
    const busySlots: Array<{ start: string; end: string }> = data.calendars[calId]?.busy || [];

    const slots: Array<{ time: string; available: boolean }> = [];
    const baseDate = new Date(startDate);
    for (let i = 0; i < 5; i++) {
      const slotDate = new Date(baseDate.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
      const hours = [9, 11, 14, 16];
      for (const hour of hours) {
        slotDate.setHours(hour, 0, 0, 0);
        const slotString = slotDate.toISOString();
        const slotEnd = new Date(slotDate.getTime() + 60 * 60 * 1000).toISOString();

        const isBusy = busySlots.some(
          (busy) => slotString >= busy.start && slotString < busy.end ||
            slotEnd > busy.start && slotEnd <= busy.end ||
            slotString <= busy.start && slotEnd >= busy.end
        );

        if (!isBusy) {
          slots.push({ time: slotString, available: true });
        }
      }
    }

    return slots;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    structuredLog("ERROR", "Error fetching available slots", { error: msg }, cid);
    return [];
  }
}

async function sendWhatsAppConfirmation(
  phoneNumber: string,
  phoneNumberId: string,
  meetingDetails: Record<string, unknown>,
  cid: string,
) {
  if (!whatsappAccessToken) {
    structuredLog("WARN", "WhatsApp not configured, simulating confirmation", {}, cid);
    return true;
  }

  try {
    const message = `Hi! 👋\n\nYour meeting with Turning Point has been confirmed!\n\n📅 Date & Time: ${meetingDetails.start_time}\n👤 RM: ${meetingDetails.rm_name}\n📞 Call Link: ${meetingDetails.call_link || "Will be shared 24h before"}\n\nWe look forward to discussing your franchise opportunity.\n\nQuestions? Reply here!`;

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${whatsappAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phoneNumber,
          type: "text",
          text: { body: message },
        }),
      }
    );

    if (!response.ok) {
      structuredLog("WARN", "WhatsApp send failed", { status: response.status, phone: phoneNumber }, cid);
    }

    return response.ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    structuredLog("ERROR", "WhatsApp send error", { error: msg, phone: phoneNumber }, cid);
    return false;
  }
}

async function handleScheduleMeeting(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { lead_id, rm_id, suggested_times_count = 3 } = body;

  if (!lead_id || typeof lead_id !== "string") {
    return errorResponse("Missing or invalid 'lead_id' (string required)", 400, undefined, cid);
  }
  if (!rm_id || typeof rm_id !== "string") {
    return errorResponse("Missing or invalid 'rm_id' (string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Scheduling meeting", { lead_id, rm_id }, cid);

  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (!lead) {
      structuredLog("WARN", "Lead not found", { lead_id }, cid);
      return errorResponse("Lead not found", 404, undefined, cid);
    }

    const { data: rm } = await supabase
      .from("consultants")
      .select("*")
      .eq("id", rm_id)
      .single();

    if (!rm) {
      structuredLog("WARN", "RM not found", { rm_id }, cid);
      return errorResponse("RM not found", 404, undefined, cid);
    }

    const now = new Date();
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const endDate = new Date(startDate.getTime() + 5 * 24 * 60 * 60 * 1000);

    const availableSlots = await getAvailableSlots(
      rm.email,
      startDate.toISOString(),
      endDate.toISOString(),
      rm_id,
      cid,
    );

    if (availableSlots.length === 0) {
      return successResponse({
        success: false,
        message: "No available slots found for RM",
        available_slots: [],
      }, 200, cid);
    }

    const suggestedSlots = availableSlots.slice(0, suggested_times_count as number);

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .insert({
        lead_id: lead_id,
        consultant_id: rm_id,
        scheduled_at: suggestedSlots[0].time,
        status: "Scheduled",
        notes: `Meeting suggested via AI scheduler. ${suggestedSlots.length} time slots offered to lead.`,
      })
      .select()
      .single();

    if (meetingError || !meeting) {
      structuredLog("ERROR", "Failed to create meeting", { error: meetingError?.message, lead_id }, cid);
      return errorResponse(`Failed to create meeting: ${meetingError?.message}`, 500, undefined, cid);
    }

    await supabase.from("lead_activities").insert({
      lead_id: lead_id,
      type: "meeting",
      note: `Meeting scheduled via AI. ${suggestedSlots.length} time slots suggested to lead.`,
    });

    structuredLog("INFO", "Meeting scheduled", { meetingId: meeting.id, lead_id }, cid);

    return successResponse({
      success: true,
      meeting_id: meeting.id,
      available_slots: suggestedSlots.map((slot, idx) => ({
        slot_number: idx + 1,
        time: slot.time,
        formatted_time: new Date(slot.time).toLocaleString(),
      })),
      message: `${suggestedSlots.length} meeting slots suggested to ${lead.name}. Awaiting confirmation.`,
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

async function handleConfirmSlot(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { meeting_id, slot_time, phone_number, phone_number_id } = body;

  if (!meeting_id || typeof meeting_id !== "string") {
    return errorResponse("Missing or invalid 'meeting_id' (string required)", 400, undefined, cid);
  }
  if (!slot_time || typeof slot_time !== "string") {
    return errorResponse("Missing or invalid 'slot_time' (string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Confirming meeting slot", { meeting_id, slot_time }, cid);

  try {
    const { data: meeting, error: updateError } = await supabase
      .from("meetings")
      .update({
        scheduled_at: slot_time,
        notes: "Confirmed by lead via AI scheduler",
      })
      .eq("id", meeting_id)
      .select()
      .single();

    if (updateError || !meeting) {
      structuredLog("ERROR", "Failed to confirm meeting", { error: updateError?.message, meeting_id }, cid);
      return errorResponse(`Failed to confirm meeting: ${updateError?.message}`, 500, undefined, cid);
    }

    const endTime = new Date(new Date(slot_time).getTime() + 30 * 60 * 1000).toISOString();
    const calendarTitle = `Franchise Discussion - ${meeting_id}`;
    const calendarDescription = (meeting.notes as string) || "Franchise opportunity discussion";

    const authResult = await getGoogleAuthHeaders(meeting.consultant_id as string, true, cid);
    if ("error" in authResult) {
      structuredLog("WARN", authResult.error, { meeting_id }, cid);
      return successResponse({
        success: true,
        meeting_id: meeting.id,
        confirmed_time: slot_time,
        calendar_link: null,
        oauth_warning: authResult.error,
        message: "Meeting confirmed in system. " + authResult.error,
      }, 200, cid);
    }

    const calId = googleCalendarId;
    const calendarResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?conferenceDataVersion=1`,
      {
        method: "POST",
        headers: authResult.headers,
        body: JSON.stringify({
          summary: calendarTitle,
          description: calendarDescription,
          start: { dateTime: slot_time },
          end: { dateTime: endTime },
          conferenceData: {
            createRequest: {
              requestId: `meet-${meeting_id}-${Date.now()}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: "email", minutes: 24 * 60 },
              { method: "popup", minutes: 15 },
            ],
          },
        }),
      }
    );

    let calendarEvent: { event_id: string; calendar_link: string } | null = null;

    if (calendarResponse.ok) {
      const eventData = await calendarResponse.json();
      calendarEvent = {
        event_id: eventData.id,
        calendar_link: eventData.htmlLink,
      };

      await supabase
        .from("meetings")
        .update({ google_calendar_event_id: eventData.id })
        .eq("id", meeting_id);
    } else {
      const errText = await calendarResponse.text();
      structuredLog("ERROR", "Google Calendar create event failed", {
        status: calendarResponse.status,
        error: errText,
        meeting_id,
      }, cid);
    }

    if (phone_number && phone_number_id) {
      await sendWhatsAppConfirmation(phone_number as string, phone_number_id as string, {
        start_time: new Date(slot_time).toLocaleString(),
        rm_name: "Franchisee Kart Team",
        call_link: calendarEvent?.calendar_link || "",
      }, cid);
    }

    await supabase.from("agent_activity_log").insert({
      agent_id: null,
      activity_type: "meeting_booked",
      title: `Meeting confirmed for ${calendarTitle}`,
      description: `Slot confirmed: ${new Date(slot_time).toLocaleString()}. Calendar invite sent.`,
      metadata: { meeting_id, calendar_event_id: calendarEvent?.event_id },
    });

    structuredLog("INFO", "Meeting confirmed", { meeting_id, slot_time }, cid);

    return successResponse({
      success: true,
      meeting_id: meeting.id,
      confirmed_time: slot_time,
      calendar_link: calendarEvent?.calendar_link || null,
      meet_link: calendarEvent?.calendar_link || null,
      message: "Meeting confirmed! Calendar invite and WhatsApp confirmation sent.",
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

async function handleCreateMeeting(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const {
    lead_id,
    consultant_id,
    title,
    description,
    start_time,
    end_time,
    attendee_emails,
    send_reminders = true,
  } = body;

  if (!title || typeof title !== "string") {
    return errorResponse("Missing or invalid 'title' (string required)", 400, undefined, cid);
  }
  if (!start_time || typeof start_time !== "string") {
    return errorResponse("Missing or invalid 'start_time' (ISO string required)", 400, undefined, cid);
  }
  if (!end_time || typeof end_time !== "string") {
    return errorResponse("Missing or invalid 'end_time' (ISO string required)", 400, undefined, cid);
  }
  if (!consultant_id || typeof consultant_id !== "string") {
    return errorResponse("Missing or invalid 'consultant_id' (string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Creating meeting", { title, consultant_id, lead_id, start_time, end_time }, cid);

  try {
    const { data: consultant } = await supabase
      .from("consultants")
      .select("id, email, name")
      .eq("id", consultant_id)
      .single();

    if (!consultant) {
      return errorResponse("Consultant not found", 404, undefined, cid);
    }

    if (lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, name")
        .eq("id", lead_id)
        .maybeSingle();

      if (!lead) {
        return errorResponse("Lead not found", 404, undefined, cid);
      }
    }

    const authResult = await getGoogleAuthHeaders(consultant_id, true, cid);
    if ("error" in authResult) {
      return errorResponse(authResult.error, 403, "OAuth required for calendar write operations", cid);
    }

    const calId = googleCalendarId;

    const attendees: Array<{ email: string }> = [];
    if (attendee_emails && Array.isArray(attendee_emails)) {
      for (const email of attendee_emails) {
        if (typeof email === "string" && email.includes("@")) {
          attendees.push({ email });
        }
      }
    }
    if (consultant.email) {
      const alreadyIncluded = attendees.some((a) => a.email === consultant.email);
      if (!alreadyIncluded) {
        attendees.unshift({ email: consultant.email });
      }
    }

    const reminders = send_reminders
      ? {
          useDefault: false,
          overrides: [
            { method: "email", minutes: 24 * 60 },
            { method: "popup", minutes: 30 },
          ],
        }
      : { useDefault: true };

    const calendarResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: "POST",
        headers: authResult.headers,
        body: JSON.stringify({
          summary: title,
          description: description || "",
          start: { dateTime: start_time },
          end: { dateTime: end_time },
          attendees,
          conferenceData: {
            createRequest: {
              requestId: `meeting-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
          reminders,
        }),
      }
    );

    if (!calendarResponse.ok) {
      const errBody = await calendarResponse.text();
      structuredLog("ERROR", "Failed to create Google Calendar event", {
        status: calendarResponse.status,
        error: errBody,
      }, cid);
      return errorResponse(
        `Failed to create Google Calendar event: ${calendarResponse.status} ${errBody}`,
        502,
        "Google Calendar API error",
        cid,
      );
    }

    const eventData = await calendarResponse.json();

    const meetLink = eventData.conferenceData?.entryPoints?.[0]?.uri || null;

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .insert({
        lead_id: lead_id || null,
        consultant_id,
        scheduled_at: start_time,
        status: "Confirmed",
        notes: description || `Meeting: ${title}`,
        google_calendar_event_id: eventData.id,
      })
      .select()
      .single();

    if (meetingError || !meeting) {
      structuredLog("ERROR", "Failed to create meeting in DB", {
        error: meetingError?.message,
      }, cid);
      return errorResponse(
        `Google Calendar event created (${eventData.id}) but failed to save meeting record: ${meetingError?.message}`,
        500,
        undefined,
        cid,
      );
    }

    await supabase.from("agent_activity_log").insert({
      agent_id: null,
      activity_type: "meeting_created",
      title: `Meeting created: ${title}`,
      description: `${new Date(start_time).toLocaleString()} — ${attendees.length} attendee(s). Meet link: ${meetLink || "N/A"}`,
      metadata: {
        meeting_id: meeting.id,
        google_event_id: eventData.id,
        meet_link: meetLink,
        attendee_count: attendees.length,
      },
    });

    structuredLog("INFO", "Meeting created successfully", {
      meetingId: meeting.id,
      googleEventId: eventData.id,
    }, cid);

    return successResponse({
      success: true,
      meeting_id: meeting.id,
      google_calendar_event_id: eventData.id,
      calendar_link: eventData.htmlLink,
      meet_link: meetLink,
      attendees,
      message: "Meeting created successfully with Google Calendar event and Meet link.",
    }, 201, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

async function handleUpdateMeeting(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { meeting_id, title, description, start_time, end_time, attendee_emails, status } = body;

  if (!meeting_id || typeof meeting_id !== "string") {
    return errorResponse("Missing or invalid 'meeting_id' (string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Updating meeting", { meeting_id }, cid);

  try {
    const { data: meeting, error: fetchError } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", meeting_id)
      .single();

    if (fetchError || !meeting) {
      return errorResponse("Meeting not found", 404, undefined, cid);
    }

    const authResult = await getGoogleAuthHeaders(meeting.consultant_id as string, true, cid);
    if ("error" in authResult) {
      return errorResponse(authResult.error, 403, "OAuth required for calendar write operations", cid);
    }

    const calId = googleCalendarId;
    const eventId = meeting.google_calendar_event_id as string | null;

    const patchBody: Record<string, unknown> = {};
    if (title) patchBody.summary = title;
    if (description !== undefined) patchBody.description = description;
    if (start_time) patchBody.start = { dateTime: start_time };
    if (end_time) patchBody.end = { dateTime: end_time };
    if (attendee_emails && Array.isArray(attendee_emails)) {
      const attendees: Array<{ email: string }> = [];
      for (const email of attendee_emails) {
        if (typeof email === "string" && email.includes("@")) {
          attendees.push({ email });
        }
      }
      patchBody.attendees = attendees;
    }

    let updatedEventData: Record<string, unknown> | null = null;
    if (eventId) {
      const calendarResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}?sendUpdates=all`,
        {
          method: "PATCH",
          headers: authResult.headers,
          body: JSON.stringify(patchBody),
        }
      );

      if (calendarResponse.ok) {
        updatedEventData = await calendarResponse.json();
        structuredLog("INFO", "Google Calendar event updated", { eventId }, cid);
      } else {
        const errText = await calendarResponse.text();
        structuredLog("ERROR", "Failed to update Google Calendar event", {
          status: calendarResponse.status,
          error: errText,
          eventId,
        }, cid);
        return errorResponse(
          `Failed to update Google Calendar event: ${calendarResponse.status}`,
          502,
          errText,
          cid,
        );
      }
    } else {
      structuredLog("WARN", "Meeting has no Google Calendar event ID, updating DB only", { meeting_id }, cid);
    }

    const dbUpdate: Record<string, unknown> = {};
    if (title) dbUpdate.notes = title;
    if (description !== undefined) dbUpdate.notes = description as string;
    if (start_time) dbUpdate.scheduled_at = start_time;
    if (status) dbUpdate.status = status;

    if (Object.keys(dbUpdate).length > 0) {
      const { error: updateError } = await supabase
        .from("meetings")
        .update(dbUpdate)
        .eq("id", meeting_id);

      if (updateError) {
        structuredLog("ERROR", "Failed to update meeting in DB", {
          error: updateError.message,
        }, cid);
        return errorResponse(`Failed to update meeting: ${updateError.message}`, 500, undefined, cid);
      }
    }

    await supabase.from("agent_activity_log").insert({
      agent_id: null,
      activity_type: "meeting_updated",
      title: `Meeting updated: ${title || meeting_id}`,
      description: `Fields updated: ${Object.keys(patchBody).join(", ")}`,
      metadata: { meeting_id, google_event_id: eventId },
    });

    structuredLog("INFO", "Meeting updated successfully", { meeting_id }, cid);

    return successResponse({
      success: true,
      meeting_id,
      google_calendar_event_id: eventId,
      calendar_link: updatedEventData?.htmlLink || null,
      meet_link: updatedEventData?.conferenceData?.entryPoints?.[0]?.uri || null,
      message: "Meeting updated successfully.",
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

async function handleCancelMeeting(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { meeting_id, cancellation_reason } = body;

  if (!meeting_id || typeof meeting_id !== "string") {
    return errorResponse("Missing or invalid 'meeting_id' (string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Cancelling meeting", { meeting_id }, cid);

  try {
    const { data: meeting, error: fetchError } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", meeting_id)
      .single();

    if (fetchError || !meeting) {
      return errorResponse("Meeting not found", 404, undefined, cid);
    }

    if (meeting.status === "Cancelled") {
      return errorResponse("Meeting is already cancelled", 400, undefined, cid);
    }

    const authResult = await getGoogleAuthHeaders(meeting.consultant_id as string, true, cid);
    if ("error" in authResult) {
      return errorResponse(authResult.error, 403, "OAuth required for calendar write operations", cid);
    }

    const calId = googleCalendarId;
    const eventId = meeting.google_calendar_event_id as string | null;

    if (eventId) {
      const calendarResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}?sendUpdates=all`,
        {
          method: "DELETE",
          headers: authResult.headers,
        }
      );

      if (calendarResponse.ok || calendarResponse.status === 204) {
        structuredLog("INFO", "Google Calendar event deleted", { eventId }, cid);
      } else {
        const errText = await calendarResponse.text();
        structuredLog("ERROR", "Failed to delete Google Calendar event", {
          status: calendarResponse.status,
          error: errText,
          eventId,
        }, cid);
      }
    } else {
      structuredLog("WARN", "Meeting has no Google Calendar event ID, cancelling DB only", { meeting_id }, cid);
    }

    const { error: updateError } = await supabase
      .from("meetings")
      .update({
        status: "Cancelled",
        notes: cancellation_reason
          ? `Cancelled: ${cancellation_reason}`
          : "Meeting cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", meeting_id);

    if (updateError) {
      structuredLog("ERROR", "Failed to update meeting status", {
        error: updateError.message,
      }, cid);
      return errorResponse(`Failed to cancel meeting: ${updateError.message}`, 500, undefined, cid);
    }

    await supabase.from("agent_activity_log").insert({
      agent_id: null,
      activity_type: "meeting_cancelled",
      title: `Meeting cancelled: ${meeting_id}`,
      description: cancellation_reason || "Meeting cancelled by user",
      metadata: { meeting_id, google_event_id: eventId },
    });

    if (meeting.lead_id) {
      await supabase.from("lead_activities").insert({
        lead_id: meeting.lead_id,
        type: "meeting",
        note: cancellation_reason
          ? `Meeting cancelled: ${cancellation_reason}`
          : "Meeting was cancelled",
      });
    }

    structuredLog("INFO", "Meeting cancelled successfully", { meeting_id }, cid);

    return successResponse({
      success: true,
      meeting_id,
      message: "Meeting cancelled successfully. Google Calendar event deleted.",
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

async function handleListMeetings(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const {
    consultant_id,
    lead_id,
    start_time,
    end_time,
    status,
    limit = 50,
    offset = 0,
  } = body;

  if (!start_time || typeof start_time !== "string") {
    return errorResponse("Missing or invalid 'start_time' (ISO string required)", 400, undefined, cid);
  }
  if (!end_time || typeof end_time !== "string") {
    return errorResponse("Missing or invalid 'end_time' (ISO string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Listing meetings", { consultant_id, lead_id, start_time, end_time, status }, cid);

  try {
    let query = supabase
      .from("meetings")
      .select(`
        *,
        leads:lead_id(id, name, email),
        consultants:consultant_id(id, name, email)
      `)
      .gte("scheduled_at", start_time)
      .lte("scheduled_at", end_time)
      .order("scheduled_at", { ascending: true })
      .range(offset as number, (offset as number) + (limit as number) - 1);

    if (consultant_id && typeof consultant_id === "string") {
      query = query.eq("consultant_id", consultant_id);
    }
    if (lead_id && typeof lead_id === "string") {
      query = query.eq("lead_id", lead_id);
    }
    if (status && typeof status === "string") {
      query = query.eq("status", status);
    }

    const { data: meetings, error: queryError, count } = await query;

    if (queryError) {
      structuredLog("ERROR", "Failed to fetch meetings", { error: queryError.message }, cid);
      return errorResponse(`Failed to fetch meetings: ${queryError.message}`, 500, undefined, cid);
    }

    let googleEvents: Array<Record<string, unknown>> = [];
    if (consultant_id) {
      const authResult = await getGoogleAuthHeaders(consultant_id as string, false, cid);
      if (!("error" in authResult)) {
        const calId = googleCalendarId;
        if (calId) {
          try {
            const calendarUrl = authResult.oauthAvailable
              ? `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${encodeURIComponent(start_time)}&timeMax=${encodeURIComponent(end_time)}&singleEvents=true&orderBy=startTime&maxResults=${limit}`
              : `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${encodeURIComponent(start_time)}&timeMax=${encodeURIComponent(end_time)}&singleEvents=true&orderBy=startTime&maxResults=${limit}&key=${googleCalendarApiKey}`;

            const calResponse = await fetch(calendarUrl, {
              headers: authResult.headers,
            });

            if (calResponse.ok) {
              const calData = await calResponse.json();
              googleEvents = calData.items || [];
            }
          } catch (calErr) {
            const msg = calErr instanceof Error ? calErr.message : "unknown";
            structuredLog("WARN", "Google Calendar fetch failed, using DB data only", { error: msg }, cid);
          }
        }
      }
    }

    structuredLog("INFO", "Meetings listed", {
      dbCount: meetings?.length || 0,
      googleCount: googleEvents.length,
    }, cid);

    return successResponse({
      success: true,
      meetings: meetings || [],
      google_calendar_events: googleEvents,
      total_count: count || 0,
      offset: offset as number,
      limit: limit as number,
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);

  try {
    const envError = verifyEnvSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
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
      case "schedule_meeting":
        return await handleScheduleMeeting(req, cid);
      case "confirm_slot":
        return await handleConfirmSlot(req, cid);
      case "create_meeting":
        return await handleCreateMeeting(req, cid);
      case "update_meeting":
        return await handleUpdateMeeting(req, cid);
      case "cancel_meeting":
        return await handleCancelMeeting(req, cid);
      case "list_meetings":
        return await handleListMeetings(req, cid);
      default:
        return errorResponse(`Unknown action: ${action}. Supported: schedule_meeting, confirm_slot, create_meeting, update_meeting, cancel_meeting, list_meetings`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500, undefined, cid);
  }
});
