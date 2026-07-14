# Dealer CRM — Wave 1 Adversarial Review

**Builder:** Database Architect + Security Engineer (FK AIOS Software Factory)
**Reviewer:** adversarial pass — mandate was to BREAK the builder's work, not admire it.

## 🔴 CRITICAL — two holes found in `004_auth_rls_hardening.sql`. Both would have shipped.

### HOLE 1 — the money gate only fired on UPDATE
The trigger was `BEFORE UPDATE`. An **INSERT** carrying `status='approved'` and a
`price_inr` went straight past it. The CHECK constraint demanded an
`approved_by_user_id` — but an internal user could simply supply **their own id**.

**Fixed:** trigger is now `BEFORE INSERT OR UPDATE`.

### HOLE 2 — the AI could walk through the money gate (worse)
The first draft allowed `service_role` to bypass the check:
```sql
IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- service_role bypass
```
**Every AI engine in this company runs as `service_role`.** I had written a money-gate
that the AI could open — inside a file whose own comment reads *"AI NEVER MOVES MONEY."*
That is the exact class of self-contradiction that produced 5,970 fabricated job
completions in the parent system.

**Fixed:** the gate no longer cares **who is executing**. It cares that the **approver
named on the row** is a real founder (`user_is_founder(NEW.approved_by_user_id)`).
A service-role engine may *draft* an invoice; it cannot *invent an approver*, because
it cannot forge a row in `user_roles`.

> **The principle, stated once so it is never lost:**
> Authorisation must key on the **identity of the approver recorded on the row**,
> not on the **identity of the caller executing the statement**.

## ✅ Verified
- Paren balance 0 on all 4 migrations; 91 statements total.
- RLS enabled on every table **before any row exists** (retrofitting RLS onto populated
  tables is how data leaks happen).
- `anon` has **no policy on any table** — under RLS, absence of policy = deny. Public
  reads go through a SECURITY DEFINER function that hand-picks marketing-safe columns.
  This closes the row-vs-column trap: an anon SELECT policy on `dealers` would have
  exposed `credit_limit_inr` and `margin_pct`, because **RLS is row-level, not
  column-level**.
- `leads.lead_score` has **NO DEFAULT** — deliberately. The parent system used
  `DEFAULT 0` while its qualifier selected `WHERE lead_score IS NULL`, so every inbound
  lead was born at 0, never seen by the qualifier, and sat unscored forever.
- `paid_means_money_arrived` — an invoice cannot be marked `paid` with ₹0 received.
  Revenue reporting is structurally unfakeable.
- `ai_completion_requires_evidence` — an AI cannot log a completed activity without
  evidence. A human can (they were there); a machine must show its work.

## ⚠️ Known limitations — NOT VERIFIED
- **Execution not verified.** The SQL is reviewed and parse-checked but has **not been
  run**. It deliberately was **not** applied to the FKAIOS enterprise database — a
  product's schema does not belong in the holding company's operational DB, and
  executing untested DDL there to "prove it works" risks a self-inflicted incident.
- **BLOCKED:** execution verification requires a dedicated Dealer CRM Supabase project
  (credentials — Founder gate).

## Minor (queued, not blocking)
- `uq_primary_contact` is partial on `is_primary`; contacts with a NULL `dealer_id`
  can therefore hold multiple primaries (NULLs are distinct in a unique index).
  Low impact — contacts without a dealer are orphans by definition.
- `leads.lead_score` and `bant_scores.total` can drift. A trigger to sync them is
  queued for wave 2 rather than bolted on here.
