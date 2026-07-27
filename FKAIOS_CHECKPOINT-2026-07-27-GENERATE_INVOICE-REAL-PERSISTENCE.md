# FKAIOS Checkpoint — GENERATE_INVOICE Real Persistence + ai_jobs Retry Constraint Fix

**Date:** 2026-07-27
**Status:** Deployed (ai-engine v52), live-verified end to end, committed. Not yet pushed.
**Scope:** Two changes verified in this session — GENERATE_INVOICE real persistence (a third HANDS capability, after QUALIFY_LEAD) and an independently-discovered `ai_jobs` status-constraint bug fix. No other job type, migration, or business logic touched.

---

## 1. Context

GENERATE_INVOICE was one of three job types (`NO_PERSISTENCE_JOB_TYPES`) that Phase 0.1 rejected outright — 153 jobs had been marked `completed` against 0 rows in any invoice table, so the honest fix at the time was to fail loudly instead of reporting an LLM opinion as completed business execution. This session builds the missing persistence so GENERATE_INVOICE can complete honestly.

## 2. What was built

**`writeInvoicePersistence()`** (`supabase/functions/ai-engine/index.ts`) — GENERATE_INVOICE moves out of `NO_PERSISTENCE_JOB_TYPES`. On success, it now:
- Resolves the job's `lead_id` to a real `leads` row and `company_id`.
- Normalizes whatever line-item shape the LLM's JSON output actually used — three shapes observed in production during this session's testing: `line_items[{description,quantity,unit_price_inr}]`, `invoice.items[{description,amount}]`, and top-level `items[{description,amount}]`. Never fabricates a value; a shape that doesn't match any of these fails the job honestly instead of guessing.
- Computes totals itself (18% GST default, matching invoice-engine's own formula) rather than trusting any total the LLM claims.
- Inserts into `company_invoices` — the existing, founder-approval-gated, governance-integrated invoice system (`invoice-engine`'s own table), not the separate `invoices`/`invoice_items` pair used by `payment-engine`'s disconnected Razorpay flow.
- Writes `execution_log` evidence (`action: generate_invoice`, success or failure) on every attempt.

**Idempotency:** `company_invoices.source_job_id` (new nullable `uuid` FK to `ai_jobs.id`, `ON DELETE SET NULL`) plus a partial unique index (`WHERE source_job_id IS NOT NULL`) is the idempotency key. A `23505` unique-violation on insert is caught and treated as "this job already created its invoice" — the existing row is fetched and returned rather than duplicating or failing.

**GENERATE_INVOICE-scoped prompt addition:** the LLM previously received zero schema guidance for this job type — the generic prompt only said "respond with JSON." A job-type-scoped instruction (`invoiceSchemaBlock`, only injected when `job.type === "GENERATE_INVOICE"`) now tells the model the target `line_items` shape. This did not make the model's output deterministic (it still varied across calls), but the three-shape normalizer above absorbs that variance without fabricating data.

### Independently discovered: `ai_jobs_status_check` constraint bug

While verifying GENERATE_INVOICE, a test job got stuck in `status='running'` forever despite its own `execution_log` failure row proving the code's catch block had run. Root cause: the `ai_jobs_status_check` CHECK constraint only ever allowed `['pending','running','completed','failed']` — never `'retry'` — but `runJobs()`'s catch block (pre-existing code, not authored this session) has always computed `status:'retry'` on a job's first two failures. Every such write silently violated the constraint and did nothing (the error was never checked), leaving the job stuck in `running` until the orphan reaper requeued it.

**Fix:** additive migration widening the constraint to `['pending','running','completed','failed','retry']`. Confirmed via `pg_constraint` that the new definition is exact, and via `pg_trigger` that `ai_jobs` has zero triggers (ruled out as an alternate cause). Confirmed fixed through the real, unmodified `job-scheduler-drain` cron (not manual SQL).

## 3. Migrations

- `20260727100000_company_invoices_source_job_id.sql` — adds `source_job_id` column + unique partial index.
- `20260727110000_ai_jobs_allow_retry_status.sql` — widens `ai_jobs_status_check`.

Both applied to live Supabase project `nrlsqshkjuuwiovthrnb`, verified via direct schema inspection before and after.

## 4. Live verification evidence

Verified through the real, unmodified production cron (`job-scheduler-drain`, `*/10 * * * *`) — no manual invocation, no special-cased test path. Test lead: `b021fadf-2a7a-4856-99f9-4c8d02de1dc8` — Five Star Chicken India.

**Successful completion (`ai_jobs` id `7e361826-7e0f-4044-9a29-f011f26c7002`):**
- `ai_jobs.status`: `completed`, `updated_at`: `2026-07-27 12:10:09.796+00`
- `company_invoices` row `d4954114-9062-49f5-abed-265643ef5251`:
  - `invoice_number`: `INV-2026-0001-9175`
  - `source_job_id`: matches the job id exactly
  - `line_items`: 3 real items (registration fee 50000, training fee 15000, royalty setup fee 10000 — all sourced from the job payload, nothing invented)
  - `subtotal_inr`: 75000, `tax_inr`: 13500, `total_inr`: 88500 (arithmetic verified)
  - `status`: `pending_approval` (correct governance-gated initial state)
- `execution_log` row `id 2755`: `action: generate_invoice`, `status: success`, `output_summary` references the same invoice id/number/total, `created_at: 2026-07-27 12:10:09.770583+00` (within milliseconds of the job's own completion timestamp)

**Idempotency (retry of the same job):** the job was reset to `pending` and reprocessed through the same real cron. `company_invoices` still contains exactly **1** row for `source_job_id = '7e361826-...'` after the retry — no duplicate created. Note: the retry's LLM call produced a fourth, unrecognized output shape (`invoice.details[]`), so the retry failed the line-item normalization check before reaching the insert step — the no-duplicate outcome is proven, but the specific `23505`-catch-and-fetch code branch was not itself exercised by this particular retry. The unique constraint's mechanical behavior was independently verified at the database level during the pre-migration safety check.

**Honest-failure path (multiple other attempts this session):** jobs whose LLM output didn't match any of the three recognized shapes correctly went to `status: retry` / `status: failed` with the real error (including a truncated raw-result snapshot for diagnosis) — never fabricated a completion. Confirmed via `execution_log` rows with `status: failure` and matching `ai_jobs.result.error`.

## 5. Deployment

- **Function:** `ai-engine`, deployed as **v52** (function id `d7bfee97-ceca-465e-b1ce-7a76ce892765`), `verify_jwt: true` unchanged.
- **Commit:** `97fcb18` — "feat(ai-engine): GENERATE_INVOICE real persistence + ai_jobs retry constraint fix"
- `deno check` clean; `deno lint` shows only the same 3 pre-existing warnings present before this session's changes (one `no-import-prefix`, two `no-explicit-any`, all outside the code touched here).

## 6. Limitations

- Only `QUALIFY_LEAD` and `GENERATE_INVOICE` have real persistence now. `GENERATE_PROPOSAL` and `SCHEDULE_MEETING` remain in the Phase 0.1 honest-failure state.
- The LLM's GENERATE_INVOICE output shape is not deterministic across calls even with the added schema instruction — the normalizer handles three observed shapes defensively, but a fourth/fifth shape can still cause an honest failure rather than a completion. This is expected behavior (no fabrication), not a regression, but means GENERATE_INVOICE's success rate depends on the model happening to produce a recognized shape.
- The `23505` idempotent-fetch code path (as opposed to the "no duplicate row" outcome) has not yet been directly exercised by a live retry in this session, due to the LLM shape variance described above. The user declined to force a synthetic proof of this specific branch, judging the DB-level constraint verification plus the "no duplicate row" outcome sufficient.
- Not yet done: push to `origin/main`, Vercel/runtime health verification (this work is Supabase/backend-only — no frontend files changed — so Vercel impact is expected to be none, but not yet explicitly re-checked this session).
