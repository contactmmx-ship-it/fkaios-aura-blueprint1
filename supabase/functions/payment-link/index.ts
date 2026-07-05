// NOTE (added during repo-sync, not part of original source): this function's
// `create` action duplicates payment-engine's `create_payment_link` action —
// both build a Razorpay payment link from an invoice, with slightly different
// request/response shapes and a different callback URL. Same real-duplication
// pattern as the whatsapp-send/whatsapp-outbound finding from an earlier
// session: not fake code, just two working implementations of the same job
// that should eventually be consolidated or explicitly differentiated.
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
const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ──────────────────────────────────────────────
// Utility: detect if Razorpay is in test mode
// ──────────────────────────────────────────────
function isTestMode(): boolean {
  return razorpayKeyId.startsWith("rzp_test_");
}

// ──────────────────────────────────────────────
// Utility: build Razorpay auth header
// ──────────────────────────────────────────────
function getRazorpayAuth(): string {
  return btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
}

// ──────────────────────────────────────────────
// Create a payment link for an invoice
// ──────────────────────────────────────────────
async function handleCreate(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { invoice_id, amount, lead_id } = body;

  if (!invoice_id || typeof invoice_id !== "string") {
    return errorResponse("Missing or invalid 'invoice_id' (string required)", 400, undefined, cid);
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return errorResponse("Missing or invalid 'amount' (positive number required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Creating payment link", { invoice_id, amount }, cid);

  try {
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("*, lead:lead_id(name, email, mobile)")
      .eq("id", invoice_id)
      .single();

    if (invErr || !invoice) {
      structuredLog("WARN", "Invoice not found", { invoice_id, error: invErr?.message }, cid);
      return errorResponse("Invoice not found", 404, undefined, cid);
    }

    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id")
      .eq("invoice_id", invoice_id)
      .eq("status", "Pending")
      .maybeSingle();

    let paymentRecord;
    if (existingPayment) {
      paymentRecord = existingPayment;
    } else {
      const { data: newPayment } = await supabase
        .from("payments")
        .insert({
          invoice_id: invoice_id,
          lead_id: lead_id || invoice.lead_id,
          amount: amount,
          method: "Razorpay",
          status: "Pending",
        })
        .select()
        .single();
      paymentRecord = newPayment;
    }

    // ── HARDENED: Return clear error when Razorpay is not configured ──
    if (!razorpayKeyId || !razorpayKeySecret) {
      structuredLog("ERROR", "Payment link creation refused — Razorpay not configured", { invoice_id }, cid);
      return errorResponse(
        "Razorpay not configured",
        503,
        "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Edge Function secrets",
        cid,
      );
    }

    const auth = getRazorpayAuth();
    const orderResponse = await fetch(
      "https://api.razorpay.com/v1/payment_links",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: Math.round(amount) * 100,
          currency: "INR",
          accept_partial: false,
          description: `Invoice INV-${invoice_id.slice(0, 8).toUpperCase()}`,
          customer: {
            name: invoice.lead?.name || "Customer",
            email: invoice.lead?.email || "noreply@franchisee-kart.com",
            contact: invoice.lead?.mobile || "+919999999999",
          },
          notes: {
            invoice_id: invoice_id,
            lead_id: lead_id || invoice.lead_id,
          },
          notify: { sms: true, email: true },
          callback_url: `${supabaseUrl}/functions/v1/payment-engine?action=handle_webhook&invoice_id=${invoice_id}`,
          callback_method: "get",
        }),
      }
    );

    if (!orderResponse.ok) {
      const errBody = await orderResponse.text();
      structuredLog("ERROR", "Razorpay payment link creation failed", {
        status: orderResponse.status,
        body: errBody,
        invoice_id,
      }, cid);
      // ── HARDENED: Propagate error instead of using fake link ──
      return errorResponse(
        `Razorpay payment link creation failed (${orderResponse.status})`,
        502,
        errBody,
        cid,
      );
    }

    const order = await orderResponse.json();
    const paymentLink = order.short_url;
    const razorpayOrderId = order.id;

    await supabase
      .from("invoices")
      .update({ razorpay_order_id: razorpayOrderId })
      .eq("id", invoice_id);

    structuredLog("INFO", "Razorpay payment link created", { orderId: razorpayOrderId, invoice_id }, cid);

    if (paymentRecord) {
      await supabase
        .from("payments")
        .update({
          payment_link: paymentLink,
          payment_gateway: "razorpay",
        })
        .eq("id", paymentRecord.id);
    }

    return successResponse({
      success: true,
      payment_id: paymentRecord?.id,
      payment_link: paymentLink,
      razorpay_order_id: razorpayOrderId,
      is_test_mode: isTestMode(),
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    structuredLog("ERROR", "Payment link creation failed", { error: message, invoice_id }, cid);
    return errorResponse(`Payment link creation failed: ${message}`, 500, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// Verify payment status
// ──────────────────────────────────────────────
async function handleVerify(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { invoice_id } = body;

  if (!invoice_id || typeof invoice_id !== "string") {
    return errorResponse("Missing or invalid 'invoice_id' (string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Verifying payment status", { invoice_id }, cid);

  try {
    const { data: confirmedPayments } = await supabase
      .from("payments")
      .select("id, amount, method, razorpay_payment_id, created_at")
      .eq("invoice_id", invoice_id)
      .eq("status", "Confirmed");

    if (confirmedPayments && confirmedPayments.length > 0) {
      await supabase
        .from("invoices")
        .update({ status: "Paid" })
        .eq("id", invoice_id);

      structuredLog("INFO", "Invoice marked as paid", { invoice_id, paymentCount: confirmedPayments.length }, cid);

      return successResponse({
        success: true,
        status: "Paid",
        payments: confirmedPayments,
        message: `Invoice marked as paid with ${confirmedPayments.length} payment(s)`,
        is_test_mode: isTestMode(),
      }, 200, cid);
    }

    const { data: pendingPayments } = await supabase
      .from("payments")
      .select("id, amount, status, payment_link, created_at")
      .eq("invoice_id", invoice_id)
      .eq("status", "Pending");

    return successResponse({
      success: true,
      status: "Pending",
      payments: pendingPayments || [],
      message: pendingPayments?.length
        ? `Payment link sent, awaiting payment`
        : "No payment initiated yet",
      is_test_mode: isTestMode(),
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(`Payment verification failed: ${message}`, 500, undefined, cid);
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

    // JWT required
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
      if (!body || typeof body !== "object" && !Array.isArray(body)) {
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
      case "create":
        return await handleCreate(req, cid);
      case "verify":
        return await handleVerify(req, cid);
      default:
        return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
