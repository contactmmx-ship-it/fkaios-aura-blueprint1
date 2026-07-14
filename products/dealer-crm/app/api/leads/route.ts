// =====================================================================
// DEALER CRM — POST /api/leads          (Lead Capture)
//               POST /api/leads/[id]/qualify  (BANT Qualifier)
// Wave 2 | Backend Engineer | REUSES: Public Lead Capture, BANT Qualifier, LLM Cost Ledger
// =====================================================================
import type { NextRequest } from 'next/server';
import { requireUser, json, fail, validateLead, logActivity } from '../../../lib/server';

// ---------------------------------------------------------------------
// POST /api/leads — capture a lead.
//
// THE CRITICAL LINE IN THIS FILE is `lead_score: null`.
// The parent enterprise had `lead_score DEFAULT 0` while its qualifier selected
// unscored leads with `WHERE lead_score IS NULL`. Every inbound lead was therefore
// born at 0, was NEVER seen by the qualifier, and sat unscored forever. The channel
// looked built and produced nothing, silently, for months.
// The schema here has NO DEFAULT — but we set NULL explicitly anyway, because
// defence in depth costs one line and the failure costs a company.
// ---------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const { db, userId, error } = await requireUser(req);
  if (error || !db || !userId) return fail(error ?? 'Unauthorized', 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('Invalid JSON'); }

  const { errors, value } = validateLead(body);
  if (errors.length) return fail(errors.join('; '), 422);

  // Dedupe: same human, same 30 days.
  //
  // ⚠ BUG FOUND IN ADVERSARIAL REVIEW — this originally used the SERVICE-ROLE client,
  // which BYPASSES RLS. If a DIFFERENT owner already held that phone number, the route
  // returned THEIR lead_id to this caller — a cross-tenant identifier leak, dressed up
  // as a harmless dedupe check. It would have passed casual review because "dedupe"
  // sounds read-only and benign.
  //
  // Now scoped through the caller's own RLS context: we can only ever see, and only
  // ever deduplicate against, rows this user owns.
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  let dupeQuery = db.from('leads').select('id').gte('created_at', since).limit(1);
  if (value.phone) dupeQuery = dupeQuery.eq('phone', value.phone);
  else dupeQuery = dupeQuery.eq('email', value.email as string);

  const { data: dupe } = await dupeQuery.maybeSingle();
  if (dupe) return json({ success: true, duplicate: true, lead_id: dupe.id, message: 'Enquiry already on record.' });

  const { data: lead, error: insErr } = await db.from('leads').insert({
    owner_user_id: userId,
    contact_name: value.contact_name,
    phone: value.phone,
    email: value.email,
    city: value.city,
    investment_capacity: value.investment_capacity,
    source: String(body.source ?? 'inbound'),
    stage: 'new',
    lead_score: null, // NOT YET SCORED. Never 0. See comment above.
  }).select('id').single();

  if (insErr) return fail(`Could not record lead: ${insErr.message}`, 500);

  await logActivity({
    owner_user_id: userId, actor_type: 'human', actor: 'inbound',
    action: 'lead_captured', outcome: `${value.contact_name} (${value.city})`,
  });

  return json({ success: true, lead_id: lead.id, scored: false });
}
