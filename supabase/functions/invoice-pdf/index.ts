// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v26 pulled 2026-07-05):
// FLAG — NOT FIXED: the footer hardcodes PLACEHOLDER bank details
// ("Bank: HDFC Bank / A/C: 50100XXXXX / IFSC: HDFC000XXXX") into every
// generated invoice. Real invoices will render with fake bank info.
// Should come from the `company` object / a settings table instead.
// Also note: GST is hardcoded as CGST 9% + SGST 9% (intra-state only);
// inter-state IGST cases are not handled.
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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function htmlResponse(html: string, cid?: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      ...(cid ? { "X-Correlation-ID": cid } : {}),
    },
  });
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function generateInvoiceHtml(invoice: Record<string, unknown>, items: Record<string, unknown>[], company: Record<string, unknown>): string {
  const invNumber = `INV-${(invoice.id as string).slice(0, 8).toUpperCase()}`;
  const invDate = new Date(invoice.created_at as string).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dueDate = invoice.due_date
    ? new Date(invoice.due_date as string).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Due on receipt";

  const subtotal = items.reduce((sum: number, i) => sum + ((i.total as number) || 0), 0);
  const cgst = Math.round(subtotal * 0.09);
  const sgst = Math.round(subtotal * 0.09);
  const grandTotal = subtotal + cgst + sgst;

  const lead = invoice.lead as Record<string, unknown> | undefined;

  const statusBadgeColor =
    invoice.status === "Paid"
      ? "#10b981"
      : invoice.status === "Overdue"
        ? "#ef4444"
        : "#f59e0b";

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
      align-items: center;
    }
    .footer-text {
      font-size: 11px;
      color: #94a3b8;
    }
    .bank-details {
      font-size: 12px;
      color: #64748b;
      line-height: 1.8;
    }
    .bank-details strong {
      color: #0f172a;
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
        ${items.length === 0
          ? '<tr><td colspan="4" class="empty-items">No line items</td></tr>'
          : items
              .map(
                (item) => `
          <tr>
            <td>
              <strong>${item.item_name}</strong>
              ${item.description ? `<br><span style="color:#94a3b8;font-size:11px">${item.description}</span>` : ""}
            </td>
            <td class="center">${item.quantity}</td>
            <td class="right">${formatINR(item.unit_price as number)}</td>
            <td class="right"><strong>${formatINR(item.total as number)}</strong></td>
          </tr>`
              )
              .join("")}
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
      <div class="bank-details">
        <strong>Bank Details</strong><br>
        Bank: HDFC Bank<br>
        A/C: 50100XXXXX<br>
        IFSC: HDFC000XXXX
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
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Correlation ID
  const cid = req.headers.get("X-Correlation-ID") || generateCorrelationId();
  structuredLog("INFO", `Request received: ${req.method} ${req.url}`, {}, cid);

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, undefined, cid);
  }

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

    // Parse and validate body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("Invalid request body: expected JSON object", 400, undefined, cid);
      }
    } catch {
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

    structuredLog("INFO", "Generating invoice HTML", { invoiceId: invoice.id }, cid);

    const itemsArray = Array.isArray(items) ? items : [];
    const companyData = (company && typeof company === "object" && !Array.isArray(company))
      ? company as Record<string, unknown>
      : { name: "Franchisee Kart", address: "New Delhi, India" };

    const html = generateInvoiceHtml(invoice, itemsArray, companyData);

    return htmlResponse(html, cid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500, undefined, cid);
  }
});
