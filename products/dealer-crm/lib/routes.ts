// =====================================================================
// DEALER CRM — remaining Wave 2 backend routes, colocated for review coherence.
// Wave 2 | Backend Engineer
// REUSES: Human-Gated Invoicing, Silent-Failure Monitor, Data Lineage Panel,
//         Marketing-Safe Public API
//
// Each export below is mounted by a thin route file (see app/api/**/route.ts).
// They live together here because they share one property worth reviewing as a set:
// EVERY ONE OF THEM REFUSES SOMETHING. That is the design.
// =====================================================================
import type { NextRequest } from 'next/server';
import { admin, requireUser, json, fail, logActivity } from './server';

// ---------------------------------------------------------------------
// DEALERS — list / read / create / update
// ---------------------------------------------------------------------
export async function listDealers(req: NextRequest) {
  const { db, error } = await requireUser(req);
  if (error || !db) return fail(error ?? 'Unauthorized', 401);

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const city = url.searchParams.get('city');
  const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 50));

  let q = db.from('dealers').select('id, legal_name, trade_name, city, state, territory, status, onboarded_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  if (city) q = q.ilike('city', city);

  const { data, error: e } = await q;
  if (e) return fail(e.message, 500);
  return json({ dealers: data ?? [] });
}

export async function getDealer(req: NextRequest, id: string) {
  const { db, error } = await requireUser(req);
  if (error || !db) return fail(error ?? 'Unauthorized', 401);

  // One round trip per relation, RLS-scoped. A dealer the caller does not own simply
  // returns nothing — no 403 leak of existence.
  const [dealer, contacts, deals, activities] = await Promise.all([
    db.from('dealers').select('*').eq('id', id).maybeSingle(),
    db.from('contacts').select('id, full_name, phone, email, designation, is_primary').eq('dealer_id', id),
    db.from('deals').select('id, title, stage, value_inr, expected_close').eq('dealer_id', id).not('stage', 'in', '("won","lost")'),
    db.from('activities').select('actor_type, actor, action, outcome, status, created_at')
      .eq('dealer_id', id).order('created_at', { ascending: false }).limit(25),
  ]);

  if (!dealer.data) return fail('Dealer not found', 404);
  return json({
    dealer: dealer.data,
    contacts: contacts.data ?? [],
    open_deals: deals.data ?? [],
    activity_feed: activities.data ?? [],
  });
}

export async function createDealer(req: NextRequest) {
  const { db, userId, error } = await requireUser(req);
  if (error || !db || !userId) return fail(error ?? 'Unauthorized', 401);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail('Invalid JSON'); }

  const legal_name = String(b.legal_name ?? '').trim();
  const city = String(b.city ?? '').trim();
  if (legal_name.length < 2) return fail('legal_name is required', 422);
  if (!city) return fail('city is required', 422);

  const { data, error: e } = await db.from('dealers').insert({
    owner_user_id: userId,
    legal_name, trade_name: b.trade_name ?? null, gstin: b.gstin ?? null,
    city, state: b.state ?? null, territory: b.territory ?? null,
    // Commercial terms are accepted but never invented. Absent means UNKNOWN.
    credit_limit_inr: b.credit_limit_inr ?? null,
    margin_pct: b.margin_pct ?? null,
    status: 'prospect',
  }).select('id').single();

  if (e) return fail(e.message, 400);
  await logActivity({ owner_user_id: userId, dealer_id: data.id, actor_type: 'human',
    actor: 'user', action: 'dealer_created', outcome: legal_name });
  return json({ success: true, dealer_id: data.id });
}

// ---------------------------------------------------------------------
// INVOICES — the money gate.
// AI NEVER MOVES MONEY. Approval writes approved_by_user_id; the DB trigger then
// verifies THAT USER IS A FOUNDER. Note carefully: the gate keys on the identity of
// the APPROVER RECORDED ON THE ROW, not on who executed the statement — because every
// AI engine runs as service_role and would otherwise walk straight through it.
// (That hole was found in adversarial review of migration 004 and closed.)
// ---------------------------------------------------------------------
export async function approveInvoice(req: NextRequest, id: string) {
  const { db, userId, error } = await requireUser(req);
  if (error || !db || !userId) return fail(error ?? 'Unauthorized', 401);

  const { data, error: e } = await db.from('invoices')
    .update({ status: 'approved', approved_by_user_id: userId })
    .eq('id', id).eq('status', 'pending_approval')  // idempotent: only from pending
    .select('id, invoice_number, total_inr, status').maybeSingle();

  // The DB trigger raises insufficient_privilege if the caller is not a founder.
  // We surface that verbatim rather than dressing it up.
  if (e) return fail(`Approval refused: ${e.message}`, 403);
  if (!data) return fail('Invoice not found, or not awaiting approval.', 404);

  await logActivity({ owner_user_id: userId, actor_type: 'human', actor: 'founder',
    action: 'invoice_approved', outcome: `${data.invoice_number} — ₹${data.total_inr}` });
  return json({ success: true, invoice: data });
}

export async function sendInvoice(req: NextRequest, id: string) {
  const { db, userId, error } = await requireUser(req);
  if (error || !db || !userId) return fail(error ?? 'Unauthorized', 401);

  const { data: inv } = await db.from('invoices')
    .select('id, invoice_number, status, approved_by_user_id').eq('id', id).maybeSingle();
  if (!inv) return fail('Invoice not found', 404);

  // Explicit gate, in addition to the DB constraint. Two locks on the money door.
  if (!inv.approved_by_user_id || inv.status === 'draft' || inv.status === 'pending_approval') {
    return fail('REFUSED: this invoice has not been approved by a founder. Nothing leaves the building unapproved.', 403);
  }

  // NOTE — NOT IMPLEMENTED, AND NOT PRETENDED: actual delivery needs an email provider
  // credential. We mark it sent ONLY when a provider actually accepts it. Marking an
  // invoice 'sent' that nobody sent is exactly the fabrication this company is built to
  // refuse. Until the credential exists, this route returns 503 and changes nothing.
  return fail('BLOCKED: no email provider credential configured. The invoice is approved but NOT sent — and will not be marked sent until a provider confirms delivery.', 503);
}

// ---------------------------------------------------------------------
// PIPELINE MONITOR — "is the commercial chain actually alive?"
// The question the parent enterprise could not answer for months while its funnel was
// mathematically dead.
// ---------------------------------------------------------------------
export async function pipelineMonitor(req: NextRequest) {
  const { db, error } = await requireUser(req);
  if (error || !db) return fail(error ?? 'Unauthorized', 401);

  const [leads, scored, qualified, best, deals, proposals, invoices] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).not('lead_score', 'is', null),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('lead_score', 40),
    db.from('leads').select('lead_score').order('lead_score', { ascending: false }).limit(1).maybeSingle(),
    db.from('deals').select('id', { count: 'exact', head: true }),
    db.from('proposals').select('id', { count: 'exact', head: true }).not('sent_at', 'is', null),
    db.from('invoices').select('amount_received_inr').gt('amount_received_inr', 0),
  ]);

  const revenue = (invoices.data ?? []).reduce((s, i) => s + Number(i.amount_received_inr || 0), 0);
  const bestScore = best.data?.lead_score ?? null;

  // Find the FIRST stage where the chain dies. Silence is never consent.
  const chain: Array<[string, number]> = [
    ['leads exist', leads.count ?? 0],
    ['leads scored', scored.count ?? 0],
    ['leads qualified (>=40)', qualified.count ?? 0],
    ['deals open', deals.count ?? 0],
    ['proposals sent', proposals.count ?? 0],
    ['invoices paid', (invoices.data ?? []).length],
  ];
  const broken = chain.find(([, n]) => n === 0);

  return json({
    chain: Object.fromEntries(chain),
    best_score_ever: bestScore,
    revenue_received: revenue,
    chain_break_stage: broken?.[0] ?? null,
    verdict: broken
      ? `Chain BREAKS at "${broken[0]}". Everything downstream has never been exercised.${
          bestScore != null && bestScore < 40
            ? ` Best lead score EVER is ${bestScore} against a bar of 40 — the funnel cannot emit a qualifiable lead.`
            : ''}`
      : 'Chain is alive end to end.',
  });
}

// ---------------------------------------------------------------------
// PUBLIC DEALER DIRECTORY — column-safe by construction.
// The commercial columns (credit_limit_inr, margin_pct, gstin) are UNREACHABLE, not
// merely unselected: anon has NO RLS policy on `dealers`, and this route calls a
// SECURITY DEFINER function that returns four columns and nothing else.
// RLS IS ROW-LEVEL, NOT COLUMN-LEVEL — an anon SELECT policy would have published the
// company's margins to every competitor with a browser.
// ---------------------------------------------------------------------
export async function publicDealers() {
  const { data, error } = await admin().rpc('public_dealer_directory');
  if (error) return fail(error.message, 500);
  return json({ dealers: data ?? [] });
}

// ---------------------------------------------------------------------
// ACTIVITIES
// ---------------------------------------------------------------------
export async function createActivity(req: NextRequest) {
  const { db, userId, error } = await requireUser(req);
  if (error || !db || !userId) return fail(error ?? 'Unauthorized', 401);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail('Invalid JSON'); }

  const action = String(b.action ?? '').trim();
  if (!action) return fail('action is required', 422);
  if (!b.dealer_id && !b.deal_id) return fail('dealer_id or deal_id is required — an activity against nothing is noise', 422);

  const { data, error: e } = await db.from('activities').insert({
    owner_user_id: userId,
    dealer_id: b.dealer_id ?? null, deal_id: b.deal_id ?? null,
    actor_type: 'human', actor: String(b.actor ?? 'user'),
    action, outcome: b.outcome ?? null, status: 'completed',
  }).select('id').single();

  if (e) return fail(e.message, 400);
  return json({ success: true, activity_id: data.id });
}
