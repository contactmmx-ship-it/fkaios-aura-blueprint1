// ============================================================
// invoice-engine v1 — Accounts department workflow, exactly as specified:
// Accounts Manager AI drafts an invoice -> founder approves or rejects in
// the UI -> ONLY on approval does it get sent to the customer. No invoice
// is ever emailed without an explicit approval action from a real request
// with a valid founder session — this is the money-adjacent action that
// stays gated, consistent with every other financial action in this system.
//
// Email delivery: attempts Resend if RESEND_API_KEY is configured. If not,
// the invoice is marked 'approved' and clearly reported as awaiting an email
// provider — it does NOT silently pretend to have sent something it didn't.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

interface LineItem { description: string; quantity: number; unit_price_inr: number; }

function computeTotals(lineItems: LineItem[], taxRatePct: number) {
  const subtotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unit_price_inr) || 0), 0);
  const tax = subtotal * (taxRatePct / 100);
  return { subtotal, tax, total: subtotal + tax };
}

async function sendInvoiceEmail(resendKey: string, to: string, invoiceNumber: string, clientName: string, totalInr: number, lineItems: LineItem[]) {
  const rows = lineItems.map((li) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #333">${li.description}</td><td style="padding:6px 12px;border-bottom:1px solid #333;text-align:right">${li.quantity}</td><td style="padding:6px 12px;border-bottom:1px solid #333;text-align:right">₹${(li.unit_price_inr).toLocaleString('en-IN')}</td></tr>`).join('');
  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
    <h2>Invoice ${invoiceNumber}</h2>
    <p>Dear ${clientName},</p>
    <p>Please find your invoice details below.</p>
    <table style="width:100%;border-collapse:collapse"><tr><th style="text-align:left;padding:6px 12px">Item</th><th style="text-align:right;padding:6px 12px">Qty</th><th style="text-align:right;padding:6px 12px">Unit Price</th></tr>${rows}</table>
    <p style="font-size:18px;font-weight:bold;margin-top:16px">Total: ₹${totalInr.toLocaleString('en-IN')}</p>
  </div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'billing@franchisekart.ai', to, subject: `Invoice ${invoiceNumber}`, html }),
  });
  if (!res.ok) throw new Error(`Resend API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnon) return err('Missing Supabase env');

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
    const parts = authHeader.slice(7).split('.');
    if (parts.length !== 3) return err('Invalid JWT', 401);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Date.now() / 1000) return err('JWT expired', 401);

    const db = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
    const body = await req.json();
    const { action } = body;

    if (action === 'list') {
      const { company_id, status } = body;
      let q = db.from('company_invoices').select('*, company:companies(name)').order('created_at', { ascending: false });
      if (company_id) q = q.eq('company_id', company_id);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return err(error.message);
      return ok({ invoices: data ?? [] });
    }

    if (action === 'draft') {
      const { company_id, client_name, client_email, client_phone, line_items, tax_rate_pct, drafted_by_agent_id } = body;
      if (!company_id || !client_name?.trim() || !Array.isArray(line_items) || line_items.length === 0) {
        return err('company_id, client_name, and at least one line_item are required', 400);
      }
      const { subtotal, tax, total } = computeTotals(line_items, tax_rate_pct ?? 18);
      const { count } = await db.from('company_invoices').select('id', { count: 'exact', head: true }).eq('company_id', company_id);
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, '0')}-${Date.now().toString().slice(-4)}`;
      const { data, error } = await db.from('company_invoices').insert({
        company_id, invoice_number: invoiceNumber, client_name: client_name.trim(), client_email: client_email || null,
        client_phone: client_phone || null, line_items, subtotal_inr: subtotal, tax_inr: tax, total_inr: total,
        status: 'pending_approval', drafted_by_agent_id: drafted_by_agent_id || null,
      }).select('*').single();
      if (error) return err(error.message);
      return ok({ invoice: data });
    }

    if (action === 'update') {
      const { id, ...fields } = body;
      if (!id) return err('id is required', 400);
      const { data: existing } = await db.from('company_invoices').select('status').eq('id', id).single();
      if (existing && existing.status !== 'draft' && existing.status !== 'pending_approval') {
        return err(`Cannot edit an invoice with status '${existing.status}'`, 400);
      }
      if (fields.line_items) {
        const { subtotal, tax, total } = computeTotals(fields.line_items, fields.tax_rate_pct ?? 18);
        fields.subtotal_inr = subtotal; fields.tax_inr = tax; fields.total_inr = total;
      }
      delete fields.action; delete fields.tax_rate_pct;
      fields.updated_at = new Date().toISOString();
      const { data, error } = await db.from('company_invoices').update(fields).eq('id', id).select('*').single();
      if (error) return err(error.message);
      return ok({ invoice: data });
    }

    if (action === 'approve') {
      const { id, approval_notes, send_now } = body;
      if (!id) return err('id is required', 400);
      const { data: inv, error: fetchErr } = await db.from('company_invoices').select('*').eq('id', id).single();
      if (fetchErr || !inv) return err('Invoice not found', 404);
      if (inv.status !== 'pending_approval' && inv.status !== 'draft') return err(`Invoice is already '${inv.status}'`, 400);

      const update: Record<string, unknown> = { status: 'approved', approved_at: new Date().toISOString(), approval_notes: approval_notes || null, updated_at: new Date().toISOString() };

      let emailResult: { sent: boolean; reason: string } = { sent: false, reason: 'send_now not requested' };
      if (send_now) {
        const resendKey = Deno.env.get('RESEND_API_KEY');
        if (!resendKey) {
          emailResult = { sent: false, reason: 'No email provider configured (RESEND_API_KEY not set) — invoice is approved but not yet sent. Tell me which email provider you set up and I will wire it in.' };
        } else if (!inv.client_email) {
          emailResult = { sent: false, reason: 'No client email on file for this invoice — cannot send.' };
        } else {
          try {
            await sendInvoiceEmail(resendKey, inv.client_email, inv.invoice_number, inv.client_name, Number(inv.total_inr), inv.line_items);
            update.status = 'sent'; update.sent_at = new Date().toISOString();
            emailResult = { sent: true, reason: 'Sent to ' + inv.client_email };
          } catch (e) {
            emailResult = { sent: false, reason: e instanceof Error ? e.message : 'Send failed' };
          }
        }
      }

      const { data, error } = await db.from('company_invoices').update(update).eq('id', id).select('*').single();
      if (error) return err(error.message);
      return ok({ invoice: data, email: emailResult });
    }

    if (action === 'reject') {
      const { id, approval_notes } = body;
      if (!id) return err('id is required', 400);
      const { data, error } = await db.from('company_invoices').update({ status: 'rejected', approval_notes: approval_notes || null, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
      if (error) return err(error.message);
      return ok({ invoice: data });
    }

    return err(`Unknown action: ${action}. Use list | draft | update | approve | reject`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('INVOICE-ENGINE ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
