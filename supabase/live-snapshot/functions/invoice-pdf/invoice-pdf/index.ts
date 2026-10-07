// ============================================================
// invoice-pdf v27 — FIX: replaced the flagged fake placeholder bank
// details ("Bank: HDFC Bank / A/C: 50100XXXXX / IFSC: HDFC000XXXX") with
// a real, working UPI payment block — VPA + scannable QR code + a
// upi://pay deep link, using the business's actual UPI ID.
//
// STAGE NOTE: this is the deliberate early-stage payment path (per
// founder decision 2026-07-05) — UPI QR/link now, full gateway (e.g.
// Cashfree) later once real transaction volume justifies the KYC/
// integration effort. Reconciliation is manual at this stage: there is
// no webhook confirming payment, so a human (or an agent watching
// bank/UPI notifications) still marks the invoice Paid. This mirrors
// exactly how invoices/transactions get written today, so switching to
// a full gateway later only adds a webhook — it doesn't change the
// invoice or accounting data model.
//
// QR code is rendered via a public QR image API (api.qrserver.com) since
// no QR-generation library is bundled in this Deno edge runtime. This is
// an external dependency: if that service is ever down, the QR image
// won't render, but the raw UPI ID and the upi://pay link text are still
// printed on the invoice as a manual fallback.
//
// Also inlined the small shared utils (previously '../_shared/utils.ts')
// directly into this file — that relative import failed to bundle via
// this deploy path. Behavior is identical to the previous version's
// utils.ts.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
// ──────────────────────────────────────────────
// Inlined shared utils (previously in ../_shared/utils.ts)
// ──────────────────────────────────────────────
function generateCorrelationId() {
  return crypto.randomUUID().slice(0, 8);
}
function structuredLog(level, message, data, cid) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    correlationId: cid || '',
    message,
    ...data ? {
      data
    } : {}
  }));
}
function errorResponse(message, status, details, cid) {
  structuredLog('ERROR', message, {
    status,
    details
  }, cid);
  return new Response(JSON.stringify({
    error: message,
    ...details ? {
      details
    } : {},
    ...cid ? {
      correlationId: cid
    } : {}
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE'
    }
  });
}
function verifyEnvSecrets(required) {
  const missing = [];
  for (const [name, value] of Object.entries(required)){
    if (!value) missing.push(name);
  }
  return missing.length > 0 ? `Missing required secrets: ${missing.join(', ')}` : null;
}
async function verifyJWT(authHeader, supabaseUrl, supabaseAnonKey) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return {
      userId: payload.sub,
      role: payload.user_role || payload.role || 'authenticated'
    };
  } catch  {
    return null;
  }
}
// ──────────────────────────────────────────────
// CORS headers
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Correlation-ID"
};
// ──────────────────────────────────────────────
// Environment & Client Setup
// ──────────────────────────────────────────────
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// Business UPI VPA for the early-stage manual-reconciliation payment path.
// Set once here; swap to a full gateway integration later without touching
// the invoice/accounting data model.
const BUSINESS_UPI_VPA = "9991111223@icici";
const BUSINESS_UPI_PAYEE_NAME = "Franchise Kart";
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
function htmlResponse(html, cid) {
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      ...cid ? {
        "X-Correlation-ID": cid
      } : {}
    }
  });
}
function formatINR(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}
// Builds a standard UPI deep link per the NPCI upi://pay spec.
function buildUpiUri(vpa, payeeName, amount, note) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: "INR",
    tn: note
  });
  return `upi://pay?${params.toString()}`;
}
function generateInvoiceHtml(invoice, items, company) {
  const invNumber = `INV-${invoice.id.slice(0, 8).toUpperCase()}`;
  const invDate = new Date(invoice.created_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }) : "Due on receipt";
  const subtotal = items.reduce((sum, i)=>sum + (i.total || 0), 0);
  const cgst = Math.round(subtotal * 0.09);
  const sgst = Math.round(subtotal * 0.09);
  const grandTotal = subtotal + cgst + sgst;
  const lead = invoice.lead;
  const statusBadgeColor = invoice.status === "Paid" ? "#10b981" : invoice.status === "Overdue" ? "#ef4444" : "#f59e0b";
  const upiVpa = company.upi_vpa || BUSINESS_UPI_VPA;
  const upiPayeeName = company.name || BUSINESS_UPI_PAYEE_NAME;
  const upiUri = buildUpiUri(upiVpa, upiPayeeName, grandTotal, invNumber);
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&data=${encodeURIComponent(upiUri)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invNumber}</title>
  <style>
    @media print {
      body { margin: 0; padding: 20mm; }
      .no-print { display: none !important; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f8fafc;
      color: #1e293b;
      padding: 20mm;
      line-height: 1.5;
    }
    .invoice {
      max-width: 210mm;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      padding: 40px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 40px;
      padding-bottom: 24px;
      border-bottom: 2px solid #0ea5e9;
    }
    .company-name {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
    }
    .company-tagline {
      font-size: 12px;
      color: #0ea5e9;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-top: 2px;
    }
    .company-details {
      font-size: 13px;
      color: #64748b;
      margin-top: 8px;
      line-height: 1.6;
    }
    .inv-badge {
      text-align: right;
    }
    .inv-number {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
    }
    .inv-meta {
      font-size: 13px;
      color: #64748b;
      margin-top: 4px;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      color: white;
      background: ${statusBadgeColor};
      margin-top: 8px;
    }
    .parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-bottom: 32px;
    }
    .party-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #94a3b8;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .party-name {
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;
    }
    .party-details {
      font-size: 13px;
      color: #64748b;
      margin-top: 4px;
      line-height: 1.6;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    thead th {
      background: #f1f5f9;
      padding: 10px 16px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      font-weight: 600;
      text-align: left;
      border-bottom: 2px solid #e2e8f0;
    }
    thead th.right, td.right {
      text-align: right;
    }
    thead th.center, td.center {
      text-align: center;
    }
    tbody td {
      padding: 12px 16px;
      font-size: 13px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .totals {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .totals-table {
      width: 280px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 13px;
      color: #64748b;
    }
    .totals-row.grand {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      border-top: 2px solid #0ea5e9;
      padding-top: 12px;
      margin-top: 8px;
    }
    .totals-row.grand span:last-child {
      color: #0ea5e9;
    }
    .footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .footer-text {
      font-size: 11px;
      color: #94a3b8;
      max-width: 280px;
    }
    .upi-block {
      display: flex;
      align-items: center;
      gap: 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px 18px;
    }
    .upi-qr img {
      display: block;
      width: 96px;
      height: 96px;
      border-radius: 6px;
    }
    .upi-details {
      font-size: 12px;
      color: #64748b;
      line-height: 1.7;
    }
    .upi-details strong {
      color: #0f172a;
      font-size: 13px;
    }
    .upi-vpa {
      font-family: 'Courier New', monospace;
      font-weight: 600;
      color: #0ea5e9;
    }
    .upi-link {
      color: #0ea5e9;
      text-decoration: none;
      font-weight: 600;
    }
    .no-print {
      text-align: center;
      margin-top: 20px;
    }
    .print-btn {
      background: #0ea5e9;
      color: white;
      border: none;
      padding: 10px 32px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .print-btn:hover { background: #0284c7; }
    .empty-items {
      text-align: center;
      padding: 32px;
      color: #94a3b8;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div>
        <div class="company-name">${company.name || "Franchisee Kart"}</div>
        <div class="company-tagline">AIOS — All-in-One Operations System</div>
        <div class="company-details">
          ${company.address || "New Delhi, India"}<br>
          ${company.email ? `Email: ${company.email}<br>` : ""}
          ${company.phone ? `Phone: ${company.phone}` : ""}
        </div>
      </div>
      <div class="inv-badge">
        <div class="inv-number">${invNumber}</div>
        <div class="inv-meta">Date: ${invDate}</div>
        <div class="inv-meta">Due: ${dueDate}</div>
        <div class="inv-meta">Type: ${invoice.type}</div>
        <div class="status-badge">${invoice.status}</div>
      </div>
    </div>

    <div class="parties">
      <div>
        <div class="party-label">Bill To</div>
        <div class="party-name">${lead?.name || "No lead assigned"}</div>
        <div class="party-details">
          ${lead?.email || ""}${lead?.email ? "<br>" : ""}
          ${lead?.mobile || ""}${lead?.mobile ? "<br>" : ""}
          ${lead?.city || ""}${lead?.city && lead?.state ? `, ${lead.state}` : ""}
        </div>
      </div>
      <div>
        <div class="party-label">From</div>
        <div class="party-name">${company.name || "Franchisee Kart"}</div>
        <div class="party-details">
          ${company.gstin ? `GSTIN: ${company.gstin}<br>` : ""}
          ${company.address || "New Delhi, India"}
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:40%">Item</th>
          <th style="width:20%" class="center">Qty</th>
          <th style="width:20%" class="right">Rate</th>
          <th style="width:20%" class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${items.length === 0 ? '<tr><td colspan="4" class="empty-items">No line items</td></tr>' : items.map((item)=>`
          <tr>
            <td>
              <strong>${item.item_name}</strong>
              ${item.description ? `<br><span style="color:#94a3b8;font-size:11px">${item.description}</span>` : ""}
            </td>
            <td class="center">${item.quantity}</td>
            <td class="right">${formatINR(item.unit_price)}</td>
            <td class="right"><strong>${formatINR(item.total)}</strong></td>
          </tr>`).join("")}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-table">
        <div class="totals-row">
          <span>Subtotal</span>
          <span>${formatINR(subtotal)}</span>
        </div>
        <div class="totals-row">
          <span>CGST (9%)</span>
          <span>${formatINR(cgst)}</span>
        </div>
        <div class="totals-row">
          <span>SGST (9%)</span>
          <span>${formatINR(sgst)}</span>
        </div>
        <div class="totals-row grand">
          <span>Grand Total</span>
          <span>${formatINR(grandTotal)}</span>
        </div>
      </div>
    </div>

    <div class="footer">
      <div class="footer-text">
        Thank you for your business.<br>
        This is a computer-generated invoice.
      </div>
      <div class="upi-block">
        <div class="upi-qr">
          <img src="${qrImageUrl}" alt="UPI QR Code" width="96" height="96">
        </div>
        <div class="upi-details">
          <strong>Pay via UPI</strong><br>
          <span class="upi-vpa">${upiVpa}</span><br>
          Amount: ${formatINR(grandTotal)}<br>
          <a class="upi-link" href="${upiUri}">Tap to pay (mobile)</a>
        </div>
      </div>
    </div>
  </div>

  <div class="no-print">
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>
</body>
</html>`;
}
// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────
Deno.serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  // Correlation ID
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, undefined, cid);
  }
  try {
    // Verify required env secrets
    const envError = verifyEnvSecrets({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey
    });
    if (envError) {
      return errorResponse(envError, 500, "Configuration error", cid);
    }
    // JWT required
    const authHeader = req.headers.get("Authorization") || "";
    const user = await verifyJWT(authHeader, supabaseUrl, supabaseAnonKey);
    if (!user) {
      return errorResponse("Unauthorized: valid JWT required", 401, undefined, cid);
    }
    // Parse and validate body
    let body;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
      }
    } catch  {
      return errorResponse("Invalid JSON in request body", 400, undefined, cid);
    }
    const { action, invoice, items, company } = body;
    if (!action || action !== "generate") {
      return errorResponse(`Unknown action: ${action}`, 400, undefined, cid);
    }
    if (!invoice || typeof invoice !== "object" || Array.isArray(invoice)) {
      return errorResponse("Missing or invalid 'invoice' data (object required)", 400, undefined, cid);
    }
    if (!invoice.id || typeof invoice.id !== "string") {
      return errorResponse("Invoice must have an 'id' field (string)", 400, undefined, cid);
    }
    structuredLog("INFO", "Generating invoice HTML", {
      invoiceId: invoice.id
    }, cid);
    const itemsArray = Array.isArray(items) ? items : [];
    const companyData = company && typeof company === "object" && !Array.isArray(company) ? company : {
      name: "Franchisee Kart",
      address: "New Delhi, India"
    };
    const html = generateInvoiceHtml(invoice, itemsArray, companyData);
    return htmlResponse(html, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
