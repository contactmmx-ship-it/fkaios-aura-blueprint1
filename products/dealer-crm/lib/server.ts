// =====================================================================
// DEALER CRM — server library. Shared by every API route.
// Manufactured by the FK AIOS Software Factory | Wave 2 | Backend Engineer
//
// Everything here is a REUSED pattern from the parent enterprise, hardened by the
// defects it actually suffered. Each block names the scar it exists to prevent.
// =====================================================================
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Service-role client. Bypasses RLS — use ONLY where the route has already
 *  established the caller's identity, or for public column-safe reads. */
export const admin = (): SupabaseClient =>
  createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** Caller-scoped client. RLS applies. This is the DEFAULT — reach for `admin()` only
 *  with a reason you could defend in review. */
export function asUser(req: NextRequest): SupabaseClient | null {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return createClient(URL, ANON, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: NextRequest) {
  const db = asUser(req);
  if (!db) return { db: null, userId: null, error: 'Unauthorized: bearer token required' };
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return { db: null, userId: null, error: 'Unauthorized: invalid token' };
  return { db, userId: data.user.id, error: null };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const fail = (message: string, status = 400) => json({ error: message }, status);

// ---------------------------------------------------------------------
// VALIDATION
// SCAR: the parent enterprise scraped 71 leads. Only 8 had a phone. ZERO had a
// budget. Its BANT qualifier therefore could not score any of them above 32 against
// a bar of 40 — the funnel was ARITHMETICALLY incapable of producing a qualified
// lead, and nobody noticed for months. A lead nobody can contact is not a lead.
// Validation here is deliberately strict at the door rather than forgiving.
// ---------------------------------------------------------------------
export function normalisePhone(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

export const isEmail = (e: unknown) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e ?? '').trim());

export function validateLead(b: Record<string, unknown>) {
  const errors: string[] = [];
  const contact_name = String(b.contact_name ?? '').trim();
  const phone = normalisePhone(b.phone);
  const email = String(b.email ?? '').trim();
  const city = String(b.city ?? '').trim();
  const capacity = b.investment_capacity == null ? null : Number(b.investment_capacity);

  if (contact_name.length < 2) errors.push('contact_name is required');
  if (!phone && !isEmail(email)) errors.push('a valid phone or email is required — an unreachable lead is not a lead');
  if (email && !isEmail(email)) errors.push('email is not valid');
  if (!city) errors.push('city is required');
  if (capacity != null && (!Number.isFinite(capacity) || capacity < 0)) errors.push('investment_capacity must be a positive number');

  return { errors, value: { contact_name, phone, email: email || null, city, investment_capacity: capacity } };
}

// ---------------------------------------------------------------------
// LLM COST LEDGER
// SCAR: the parent enterprise ran 1,188 LLM dispatches with NO cost row. Its known
// spend was a FLOOR, not a total — it could see the bill and not what it bought.
// Here, an LLM call that does not write a ledger row is a bug, not a shortcut.
// An UNKNOWN model price writes NULL, never a guessed 0: a zero silently UNDERSTATES
// burn, which is worse than admitting ignorance.
// ---------------------------------------------------------------------
export const MODEL_RATES: Record<string, { in: number; out: number }> = {
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'claude-3-haiku-20240307': { in: 0.25, out: 1.25 },
};

/** Cheapest AVAILABLE model that is genuinely good at the capability.
 *  Refuses to silently downgrade: an unknown capability returns null, and the caller
 *  must handle "NO CAPABLE MODEL AVAILABLE" rather than quietly using a bad one. */
export function chooseModel(capability: 'reasoning' | 'bulk_classification'): string | null {
  switch (capability) {
    case 'bulk_classification': return 'claude-3-haiku-20240307';
    case 'reasoning': return 'claude-sonnet-4-6';
    default: return null;
  }
}

export async function logLlmCost(p: {
  agent: string; task_type: string; model: string; provider: string;
  input_tokens?: number; output_tokens?: number; latency_ms?: number;
  selection_reason?: string; prompt_version?: string; business_objective?: string;
  success: boolean; error_message?: string; owner_user_id?: string | null;
}) {
  const rate = MODEL_RATES[p.model];
  const cost = rate
    ? ((p.input_tokens ?? 0) / 1e6) * rate.in + ((p.output_tokens ?? 0) / 1e6) * rate.out
    : null; // UNKNOWN price -> NULL. Never a guessed zero.

  await admin().from('llm_cost_ledger').insert({
    agent: p.agent, task_type: p.task_type, model: p.model, provider: p.provider,
    input_tokens: p.input_tokens ?? null, output_tokens: p.output_tokens ?? null,
    estimated_cost_usd: cost, latency_ms: p.latency_ms ?? null,
    selection_reason: p.selection_reason ?? null, prompt_version: p.prompt_version ?? null,
    business_objective: p.business_objective ?? null,
    success: p.success, error_message: p.error_message ?? null,
    owner_user_id: p.owner_user_id ?? null,
  });
}

// ---------------------------------------------------------------------
// ACTIVITY LOG
// SCAR: the parent enterprise recorded 5,970 jobs as 'completed' that never ran — a
// catch block returned a fabricated placeholder on ANY failure. An AI logging a
// completed activity MUST supply evidence; the DB rejects it otherwise
// (ai_completion_requires_evidence). This helper cannot bypass that, by design.
// ---------------------------------------------------------------------
export async function logActivity(p: {
  owner_user_id: string; dealer_id?: string | null; deal_id?: string | null;
  actor_type: 'human' | 'ai'; actor: string; action: string;
  outcome?: string; status?: 'completed' | 'failed' | 'pending'; evidence?: string;
}) {
  await admin().from('activities').insert({
    owner_user_id: p.owner_user_id,
    dealer_id: p.dealer_id ?? null, deal_id: p.deal_id ?? null,
    actor_type: p.actor_type, actor: p.actor, action: p.action,
    outcome: p.outcome ?? null, status: p.status ?? 'completed',
    evidence: p.evidence ?? null,
  });
}
