import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createHmac } from "node:crypto";
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
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Razorpay-Signature, X-Correlation-ID",
};

// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";

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
// Generate invoice for a lead
// ──────────────────────────────────────────────
async function generateInvoice(
  leadId: string,
  brandId: string,
  franchiseeDetails: Record<string, unknown>,
  cid: string,
) {
  structuredLog("INFO", "Generating invoice", { leadId, brandId }, cid);

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .single();

  if (!brand) {
    structuredLog("WARN", "Brand not found for invoice", { brandId }, cid);
    throw new Error("Brand not found");
  }

  const invoiceItems = [
    {
      item_name: `${brand.name} Franchise Fee`,
      item_type: "franchise_fee",
      quantity: 1,
      unit_price: 10000,
      description: "Initial franchise registration and brand license fee",
    },
    {
      item_name: `${brand.name} Training Program`,
      item_type: "training",
      quantity: 1,
      unit_price: 5000,
      description: "2-day in-person + 2-week remote training",
    },
    {
      item_name: `${brand.name} Initial Inventory`,
      item_type: "inventory",
      quantity: 1,
      unit_price: 3000,
      description: "Starter inventory and commissary setup",
    },
    {
      item_name: "Tech Stack & POS System Setup",
      item_type: "tech_setup",
      quantity: 1,
      unit_price: 2000,
      description: "CRM, POS, and franchise management platform access",
    },
  ];

  const totalAmount = invoiceItems.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0,
  );

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      lead_id: leadId,
      type: "Registration Fee",
      amount: totalAmount,
      status: "Pending",
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      invoice_template: {
        franchisee: franchiseeDetails,
        brand: brand.name,
        items: invoiceItems,
      },
    })
    .select()
    .single();

  if (invoiceError || !invoice) {
    structuredLog("ERROR", "Failed to create invoice", { error: invoiceError?.message, leadId }, cid);
    throw new Error(`Failed to create invoice: ${invoiceError?.message}`);
  }

  for (const item of invoiceItems) {
    await supabase.from("invoice_items").insert({
      invoice_id: invoice.id,
      item_name: item.item_name,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: item.unit_price * item.quantity,
      item_type: item.item_type,
    });
  }

  structuredLog("INFO", "Invoice generated", { invoiceId: invoice.id, amount: totalAmount }, cid);

  return invoice;
}

// ──────────────────────────────────────────────
// Create Razorpay order and payment link
// ──────────────────────────────────────────────
async function createPaymentLink(
  invoiceId: string,
  amount: number,
  email: string,
  phone: string,
  notes: Record<string, unknown>,
  cid: string,
) {
  // ── HARDENED: Reject immediately when keys are missing ──
  if (!razorpayKeyId || !razorpayKeySecret) {
    structuredLog("ERROR", "Razorpay not configured — refusing to create payment link", { invoiceId }, cid);
    throw new Error(
      "Razorpay not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Edge Function secrets.",
    );
  }

  const auth = getRazorpayAuth();

  // Create Razorpay order
  const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amount * 100,
      currency: "INR",
      receipt: invoiceId,
      notes: notes,
    }),
  });

  if (!orderResponse.ok) {
    const text = await orderResponse.text();
    structuredLog("ERROR", "Razorpay order creation failed", { status: orderResponse.status, body: text, invoiceId }, cid);
    throw new Error(`Razorpay order creation failed (${orderResponse.status}): ${text}`);
  }

  const order = await orderResponse.json();

  // Create payment link
  const paymentLinkResponse = await fetch(
    "https://api.razorpay.com/v1/payment_links",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amount * 100,
        currency: "INR",
        accept_partial: false,
        first_min_partial_amount: 0,
        email: email,
        contact: phone,
        notes: notes,
        notify: { sms: true, email: true },
        callback_url: `${supabaseUrl}/functions/v1/payment-engine?invoice_id=${invoiceId}`,
        callback_method: "get",
      }),
    }
  );

  if (!paymentLinkResponse.ok) {
    const text = await paymentLinkResponse.text();
    structuredLog("ERROR", "Payment link creation failed", { status: paymentLinkResponse.status, body: text, invoiceId }, cid);
    throw new Error(`Payment link creation failed (${paymentLinkResponse.status}): ${text}`);
  }

  const paymentLink = await paymentLinkResponse.json();

  structuredLog("INFO", "Payment link created", { orderId: order.id, invoiceId }, cid);

  return {
    razorpay_order_id: order.id,
    payment_link: paymentLink.short_url,
    is_test_mode: isTestMode(),
  };
}

// ──────────────────────────────────────────────
// Handle invoice generation request
// ──────────────────────────────────────────────
async function handleGenerateInvoice(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { lead_id, brand_id, franchisee_details } = body;

  if (!lead_id || typeof lead_id !== "string") {
    return errorResponse("Missing or invalid 'lead_id' (string required)", 400, undefined, cid);
  }
  if (!brand_id || typeof brand_id !== "string") {
    return errorResponse("Missing or invalid 'brand_id' (string required)", 400, undefined, cid);
  }

  try {
    const invoice = await generateInvoice(
      lead_id,
      brand_id,
      (franchisee_details && typeof franchisee_details === "object" && !Array.isArray(franchisee_details))
        ? franchisee_details as Record<string, unknown>
        : {},
      cid,
    );
    return successResponse({ success: true, invoice }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 500, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// Handle payment link creation
// ──────────────────────────────────────────────
async function handleCreatePaymentLink(req: Request, cid: string) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
    }
  } catch {
    return errorResponse("Invalid JSON in request body", 400, undefined, cid);
  }

  const { invoice_id, amount, email, phone, notes } = body;

  if (!invoice_id || typeof invoice_id !== "string") {
    return errorResponse("Missing or invalid 'invoice_id' (string required)", 400, undefined, cid);
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return errorResponse("Missing or invalid 'amount' (positive number required)", 400, undefined, cid);
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

  try {
    const result = await createPaymentLink(
      invoice_id,
      amount,
      (typeof email === "string" ? email : "noreply@franchisee-kart.com"),
      (typeof phone === "string" ? phone : "+919999999999"),
      (notes && typeof notes === "object" && !Array.isArray(notes) ? notes as Record<string, unknown> : {}),
      cid,
    );

    await supabase
      .from("invoices")
      .update({
        razorpay_order_id: result.razorpay_order_id,
      })
      .eq("id", invoice_id);

    return successResponse({ success: true, ...result }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 502, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// HMAC-SHA256 webhook signature verification
// HARDENED: REJECTS forged webhooks with 403
// ──────────────────────────────────────────────
function verifyRazorpayWebhook(
  body: string,
  signature: string,
  cid: string,
): boolean {
  // ── HARDENED: When webhook secret is not set, REJECT all webhooks ──
  if (!webhookSecret) {
    structuredLog("ERROR", "RAZORPAY_WEBHOOK_SECRET not configured — rejecting webhook (security risk)", {}, cid);
    return false;
  }

  if (!signature) {
    structuredLog("ERROR", "Missing X-Razorpay-Signature header — rejecting webhook", {}, cid);
    return false;
  }

  const expectedHash = createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");

  const valid = expectedHash === signature;
  if (!valid) {
    structuredLog("ERROR", "Razorpay webhook signature MISMATCH — rejecting forged webhook", {
      received: signature.slice(0, 16) + "...",
      expected: expectedHash.slice(0, 16) + "...",
    }, cid);
  }

  return valid;
}

// ──────────────────────────────────────────────
// Handle Razorpay webhook (payment success/failure)
// ──────────────────────────────────────────────
async function handlePaymentWebhook(req: Request, cid: string) {
  const signature = req.headers.get("X-Razorpay-Signature") || "";
  const body = await req.text();

  // ── HARDENED: Reject forged webhooks with 403 ──
  if (!verifyRazorpayWebhook(body, signature, cid)) {
    return errorResponse("Forbidden: invalid webhook signature", 403, "Webhook rejected — HMAC-SHA256 signature verification failed", cid);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(body);
  } catch {
    return errorResponse("Invalid JSON in webhook body", 400, undefined, cid);
  }

  structuredLog("INFO", "Payment webhook received", { eventId: event.id, eventType: event.event }, cid);

  // Log webhook event
  await supabase.from("payment_webhooks").insert({
    event_id: event.id,
    event_type: event.event,
    payload: event.payload,
    processed: false,
  });

  if (event.event === "payment.authorized") {
    const payment = (event.payload as Record<string, unknown>)?.payment as Record<string, unknown>;
    if (!payment) {
      structuredLog("ERROR", "Payment webhook missing payment entity", { eventId: event.id }, cid);
      return successResponse({ success: true }, 200, cid);
    }

    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id")
      .eq("razorpay_payment_id", payment.id)
      .maybeSingle();

    if (!existingPayment) {
      await supabase.from("payments").insert({
        razorpay_payment_id: payment.id,
        razorpay_signature: payment.signature,
        amount: (payment.amount as number) / 100,
        method: payment.method || "razorpay",
        status: "Confirmed",
      });

      structuredLog("INFO", "New payment recorded from webhook", { paymentId: payment.id, amount: payment.amount }, cid);
    }

    await supabase
      .from("payment_webhooks")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("event_id", event.id);
  }

  return successResponse({ success: true }, 200, cid);
}

// ──────────────────────────────────────────────
// Refund flow: handleRefund()
// Calls Razorpay Refund API: POST /v1/payments/{paymentId}/refunds
// ──────────────────────────────────────────────
async function handleRefund(req: Request, cid: string) {
  // ── Verify Razorpay credentials ──
  if (!razorpayKeyId || !razorpayKeySecret) {
    structuredLog("ERROR", "Refund refused — Razorpay not configured", {}, cid);
    return errorResponse(
      "Razorpay not configured",
      503,
      "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Edge Function secrets",
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

  const { payment_id, amount, notes, reason } = body;

  if (!payment_id || typeof payment_id !== "string") {
    return errorResponse("Missing or invalid 'payment_id' (string required)", 400, undefined, cid);
  }

  const refundAmount = typeof amount === "number" && amount > 0 ? amount : null; // null = full refund
  const refundNotes = notes && typeof notes === "object" && !Array.isArray(notes) ? notes as Record<string, unknown> : {};
  const refundReason = typeof reason === "string" ? reason : undefined;

  structuredLog("INFO", "Initiating refund", { payment_id, amount: refundAmount || "full" }, cid);

  try {
    const auth = getRazorpayAuth();
    const refundPayload: Record<string, unknown> = {
      notes: refundNotes,
    };
    if (refundAmount) {
      refundPayload.amount = Math.round(refundAmount) * 100; // Razorpay expects paise
    }
    if (refundReason) {
      refundPayload.reason = refundReason;
    }

    const refundResponse = await fetch(
      `https://api.razorpay.com/v1/payments/${payment_id}/refunds`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(refundPayload),
      },
    );

    if (!refundResponse.ok) {
      const errorBody = await refundResponse.text();
      structuredLog("ERROR", "Razorpay refund API failed", {
        payment_id,
        status: refundResponse.status,
        body: errorBody,
      }, cid);

      if (refundResponse.status === 400) {
        return errorResponse("Refund failed: invalid request", 400, errorBody, cid);
      }
      if (refundResponse.status === 401) {
        return errorResponse("Refund failed: invalid Razorpay credentials", 401, undefined, cid);
      }
      return errorResponse(`Refund failed: Razorpay returned ${refundResponse.status}`, refundResponse.status, errorBody, cid);
    }

    const refund = await refundResponse.json();

    // Update payment record status to Refunded
    if (refund.payment_id) {
      await supabase
        .from("payments")
        .update({ status: "Refunded", refund_id: refund.id })
        .eq("razorpay_payment_id", refund.payment_id);
    }

    // Log refund in payment_webhooks for audit trail
    await supabase.from("payment_webhooks").insert({
      event_id: refund.id || `refund_${Date.now()}`,
      event_type: "refund.created",
      payload: refund,
      processed: true,
      processed_at: new Date().toISOString(),
    });

    structuredLog("INFO", "Refund processed successfully", {
      refundId: refund.id,
      payment_id,
      amount: refund.amount,
      status: refund.status,
    }, cid);

    return successResponse({
      success: true,
      refund: {
        id: refund.id,
        payment_id: refund.payment_id,
        amount: refund.amount ? refund.amount / 100 : undefined, // Convert back to rupees
        currency: refund.currency,
        status: refund.status,
        created_at: refund.created_at,
      },
      is_test_mode: isTestMode(),
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during refund";
    structuredLog("ERROR", "Refund processing error", { error: message, payment_id }, cid);
    return errorResponse(`Refund failed: ${message}`, 502, undefined, cid);
  }
}

// ──────────────────────────────────────────────
// Payment status polling: handleCheckStatus()
// Calls Razorpay Order API: GET /v1/orders/{orderId}
// ──────────────────────────────────────────────
async function handleCheckStatus(req: Request, cid: string) {
  // ── Verify Razorpay credentials ──
  if (!razorpayKeyId || !razorpayKeySecret) {
    structuredLog("ERROR", "Status check refused — Razorpay not configured", {}, cid);
    return errorResponse(
      "Razorpay not configured",
      503,
      "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Edge Function secrets",
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

  const { order_id } = body;

  if (!order_id || typeof order_id !== "string") {
    return errorResponse("Missing or invalid 'order_id' (string required)", 400, undefined, cid);
  }

  structuredLog("INFO", "Checking payment status", { order_id }, cid);

  try {
    const auth = getRazorpayAuth();

    const orderResponse = await fetch(
      `https://api.razorpay.com/v1/orders/${order_id}`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!orderResponse.ok) {
      const errorBody = await orderResponse.text();
      structuredLog("ERROR", "Razorpay order fetch failed", {
        order_id,
        status: orderResponse.status,
        body: errorBody,
      }, cid);

      if (orderResponse.status === 404) {
        return errorResponse("Order not found", 404, `No Razorpay order with ID: ${order_id}`, cid);
      }
      return errorResponse(
        `Failed to fetch order status: Razorpay returned ${orderResponse.status}`,
        orderResponse.status,
        errorBody,
        cid,
      );
    }

    const order = await orderResponse.json();

    // Fetch payments associated with this order for enriched status
    let payments: unknown[] = [];
    try {
      const paymentsResponse = await fetch(
        `https://api.razorpay.com/v1/orders/${order_id}/payments`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (paymentsResponse.ok) {
        const paymentsData = await paymentsResponse.json();
        payments = paymentsData.items || paymentsData;
      }
    } catch {
      // Non-critical: continue without payments list
      structuredLog("WARN", "Could not fetch order payments list", { order_id }, cid);
    }

    // Map Razorpay status to application status
    const statusMap: Record<string, string> = {
      "created": "Pending",
      "attempted": "Pending",
      "paid": "Paid",
      "expired": "Expired",
    };
    const appStatus = statusMap[order.status] || order.status;

    structuredLog("INFO", "Payment status fetched", {
      order_id,
      razorpay_status: order.status,
      app_status: appStatus,
      amount_paid: order.amount_paid,
    }, cid);

    return successResponse({
      success: true,
      order: {
        id: order.id,
        entity: order.entity,
        amount: order.amount ? order.amount / 100 : undefined,
        currency: order.currency,
        status: order.status,
        app_status: appStatus,
        attempts: order.attempts,
        amount_paid: order.amount_paid ? order.amount_paid / 100 : undefined,
        amount_due: order.amount_due ? order.amount_due / 100 : undefined,
        created_at: order.created_at,
        notes: order.notes,
      },
      payments: Array.isArray(payments)
        ? payments.map((p: Record<string, unknown>) => ({
            id: p.id,
            amount: p.amount ? (p.amount as number) / 100 : undefined,
            currency: p.currency,
            status: p.status,
            method: p.method,
            captured: p.captured,
            created_at: p.created_at,
          }))
        : [],
      is_test_mode: isTestMode(),
    }, 200, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during status check";
    structuredLog("ERROR", "Status check error", { error: message, order_id }, cid);
    return errorResponse(`Status check failed: ${message}`, 502, undefined, cid);
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

    const url = new URL(req.url);
    const pathname = url.pathname;

    // Webhook callback from Razorpay (no JWT — uses webhook signature verification)
    if (
      pathname.includes("payment-engine") &&
      req.method === "POST" &&
      url.searchParams.has("invoice_id")
    ) {
      return await handlePaymentWebhook(req, cid);
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
      case "generate_invoice": {
        // JWT required for create
        const authHeader = req.headers.get("Authorization") || "";
        const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
        if (!user) {
          return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
        }
        return await handleGenerateInvoice(req, cid);
      }

      case "create_payment_link": {
        // JWT required for create
        const authHeader = req.headers.get("Authorization") || "";
        const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
        if (!user) {
          return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
        }
        return await handleCreatePaymentLink(req, cid);
      }

      case "handle_webhook": {
        // Webhook verify for payment callback — no JWT, uses signature
        return await handlePaymentWebhook(req, cid);
      }

      // ── NEW: Refund action ──
      case "refund": {
        // JWT required for refund
        const refundAuthHeader = req.headers.get("Authorization") || "";
        const refundUser = await verifyJWT(refundAuthHeader, supabaseUrl, supabaseAnonKey);
        if (!refundUser) {
          return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
        }
        return await handleRefund(req, cid);
      }

      // ── NEW: Check payment status action ──
      case "check_status": {
        // JWT required for status check
        const statusAuthHeader = req.headers.get("Authorization") || "";
        const statusUser = await verifyJWT(statusAuthHeader, supabaseUrl, supabaseAnonKey);
        if (!statusUser) {
          return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
        }
        return await handleCheckStatus(req, cid);
      }

      default:
        return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
