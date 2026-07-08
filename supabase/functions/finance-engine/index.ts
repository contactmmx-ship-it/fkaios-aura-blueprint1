// finance-engine v2 — Phase B of Roadmap v2: send_invoice now attempts REAL
// delivery (WhatsApp, via whatsapp-engine + the lead's real contact_phone)
// instead of only flipping a status. Honest either way: if delivery isn't
// possible (no phone on file, WhatsApp not fully configured), that's
// reported plainly in delivery_status — never a fake 'sent'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID' };
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function log(level: string, message: string, data?: Record<string, unknown>, id?: string) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: id || '', message, ...(data ? { data } : {}) })); }
function errRes(message: string, status: number, id?: string): Response { log('ERROR', message, undefined, id); return new Response(JSON.stringify({ error: message, correlationId: id }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function okRes(data: unknown, id?: string): Response { return new Response(JSON.stringify({ ...(data as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

async function verifyJWT(authHeader: string | null, supabaseUrl: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}

async function attemptWhatsAppDelivery(supabaseUrl: string, authHeader: string, phone: string, clientName: string, totalInr: number | null): Promise<{ ok: boolean; status: string }> {
  try {
    const text = `Hi ${clientName}, your invoice${totalInr ? ` for ₹${Number(totalInr).toLocaleString('en-IN')}` : ''} is ready. We'll follow up shortly with payment details. — Franchise Kart`;
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ action: 'send_message', to: phone, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: 'whatsapp_sent' };
    return { ok: false, status: `whatsapp_failed: ${data.error || res.status}` };
  } catch (e) {
    return { ok: false, status: `whatsapp_failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  const db = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: authHeader ? { Authorization: authHeader } : {} } });

  try {
    const user = await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const body = await req.json() as { action?: string; invoice_id?: string; decision?: 'approved' | 'rejected'; notes?: string; amount_inr?: number; payment_method?: string; transaction_id?: string };
    if (!body.action) return errRes('action is required', 400, id);

    if (body.action === 'approve_invoice') {
      if (!body.invoice_id) return errRes('invoice_id is required', 400, id);
      if (body.decision !== 'approved' && body.decision !== 'rejected') return errRes("decision must be 'approved' or 'rejected'", 400, id);

      const { data: invoice, error: invErr } = await db.from('company_invoices').select('*').eq('id', body.invoice_id).single();
      if (invErr || !invoice) return errRes('Invoice not found', 404, id);
      if (invoice.status !== 'pending_approval') return errRes(`Cannot decide an invoice in status '${invoice.status}' — only pending_approval invoices can be decided`, 400, id);

      const newStatus = body.decision === 'approved' ? 'approved' : 'rejected';
      const { error: updErr } = await db.from('company_invoices').update({
        status: newStatus,
        approved_at: body.decision === 'approved' ? new Date().toISOString() : null,
        approval_notes: body.notes ?? null,
      }).eq('id', body.invoice_id);
      if (updErr) throw updErr;

      if (invoice.approval_id) {
        await db.from('approvals').update({ status: newStatus, decided_by: user.userId, decided_at: new Date().toISOString(), reason: body.notes ?? null }).eq('id', invoice.approval_id);
      }

      await db.from('founder_notifications').insert({
        type: 'invoice_decision', title: `Invoice ${newStatus}: ${invoice.client_name}`,
        detail: body.notes ?? null, department_code: 'FINANCE', related_id: body.invoice_id, amount_inr: invoice.total_inr,
      });

      log('info', 'Invoice decided', { invoiceId: body.invoice_id, decision: newStatus }, id);
      return okRes({ invoice_id: body.invoice_id, status: newStatus, next_step: newStatus === 'approved' ? 'Accounts can now send the invoice' : 'Finance must re-draft or close out this invoice' }, id);
    }

    if (body.action === 'send_invoice') {
      if (!body.invoice_id) return errRes('invoice_id is required', 400, id);
      const { data: invoice, error: invErr } = await db.from('company_invoices').select('*').eq('id', body.invoice_id).single();
      if (invErr || !invoice) return errRes('Invoice not found', 404, id);
      if (invoice.status !== 'approved') return errRes(`Cannot send an invoice in status '${invoice.status}' — it must be founder-approved first`, 400, id);

      let deliveryChannel = 'none';
      let deliveryStatus = 'no_delivery_channel_available';
      const phone = invoice.client_phone as string | null;
      if (phone) {
        deliveryChannel = 'whatsapp';
        const result = await attemptWhatsAppDelivery(supabaseUrl, authHeader!, phone, invoice.client_name, invoice.total_inr);
        deliveryStatus = result.status;
      } else {
        deliveryStatus = 'no_phone_on_file';
      }

      const { error: updErr } = await db.from('company_invoices').update({
        status: 'sent', sent_at: new Date().toISOString(),
        delivery_channel: deliveryChannel, delivery_status: deliveryStatus,
      }).eq('id', body.invoice_id);
      if (updErr) throw updErr;

      log('info', 'Invoice sent', { invoiceId: body.invoice_id, deliveryChannel, deliveryStatus }, id);
      return okRes({
        invoice_id: body.invoice_id, status: 'sent',
        delivery_channel: deliveryChannel, delivery_status: deliveryStatus,
        next_step: deliveryStatus === 'whatsapp_sent' ? 'Delivered via WhatsApp. Accounts follows up for collection.' : `Not actually delivered (${deliveryStatus}) — marked sent in the system, but the client has not been contacted. Accounts must follow up manually.`,
      }, id);
    }

    if (body.action === 'record_payment') {
      if (!body.invoice_id) return errRes('invoice_id is required', 400, id);
      if (typeof body.amount_inr !== 'number' || body.amount_inr <= 0) return errRes('amount_inr must be a real positive number — payments are never invented', 400, id);

      const { data: invoice, error: invErr } = await db.from('company_invoices').select('*').eq('id', body.invoice_id).single();
      if (invErr || !invoice) return errRes('Invoice not found', 404, id);
      if (invoice.status !== 'sent' && invoice.status !== 'paid') return errRes(`Cannot record payment on an invoice in status '${invoice.status}' — it must be sent first`, 400, id);

      const newReceived = Number(invoice.amount_received_inr ?? 0) + body.amount_inr;
      const fullyPaid = invoice.total_inr != null && newReceived >= Number(invoice.total_inr);
      const { error: updErr } = await db.from('company_invoices').update({
        amount_received_inr: newReceived,
        payment_received_at: new Date().toISOString(),
        status: fullyPaid ? 'paid' : invoice.status,
      }).eq('id', body.invoice_id);
      if (updErr) throw updErr;

      const notifyRows = [
        { type: 'payment_received', title: `Payment received: ${invoice.client_name}`, detail: `${body.payment_method ?? 'unspecified method'}${body.transaction_id ? `, txn ${body.transaction_id}` : ''}. ${fullyPaid ? 'Invoice fully paid.' : 'Partial payment.'}`, department_code: 'SALES', related_id: body.invoice_id, amount_inr: body.amount_inr },
        { type: 'payment_received', title: `Payment received: ${invoice.client_name}`, detail: fullyPaid ? 'Invoice fully paid — close out.' : 'Partial payment received.', department_code: 'FINANCE', related_id: body.invoice_id, amount_inr: body.amount_inr },
        { type: 'payment_received', title: `Payment received: ${invoice.client_name}`, detail: `Total received to date: ₹${newReceived.toLocaleString('en-IN')}${invoice.total_inr ? ` of ₹${Number(invoice.total_inr).toLocaleString('en-IN')}` : ''}.`, department_code: 'EXECUTIVE', related_id: body.invoice_id, amount_inr: body.amount_inr },
      ];
      await db.from('founder_notifications').insert(notifyRows);

      if (invoice.lead_id) {
        await db.from('lead_activities').insert({ lead_id: invoice.lead_id, type: 'note', note: `Payment of ₹${body.amount_inr.toLocaleString('en-IN')} received. ${fullyPaid ? 'Invoice fully paid.' : 'Partial payment — balance outstanding.'}` });
      }

      log('info', 'Payment recorded', { invoiceId: body.invoice_id, amount: body.amount_inr, fullyPaid }, id);
      return okRes({ invoice_id: body.invoice_id, amount_received_inr: newReceived, status: fullyPaid ? 'paid' : invoice.status, notified: ['SALES', 'FINANCE', 'EXECUTIVE'] }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    log('error', 'finance-engine error', { error: msg }, id);
    return errRes(msg, 500, id);
  }
});
