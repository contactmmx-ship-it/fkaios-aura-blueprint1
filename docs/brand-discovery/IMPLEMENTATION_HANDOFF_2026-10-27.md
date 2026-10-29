# Brand Discovery implementation handoff — 27 October 2026

This is a status record for the feature branch and PR #191. It is not production approval.

## Added in this implementation pass

- Respondent page: browser-native read-aloud and basic voice commands (repeat / previous / next / stop) where supported, a resume welcome message, and configurable section intro / why-it-matters copy.
- Invitation Edge Function: optional Resend invitation email, gated by server-side configuration. It still returns a one-time resume URL to the authenticated FK operator; the raw token is never stored in the database.
- Respondent Edge Function: optional separate owner completion confirmation and FK notification email. The FK email contains a submission ID and no private diagnosis or execution plan.
- Private report Edge Function: JWT-authenticated plus server-side email allowlist. Lists active templates and submitted sessions, and generates an evidence-first report from saved answers without calling paid AI.
- Private report workspace at `/brand-discovery/admin`: invitation creation from active templates, submitted-session list, and report view with owner-reported answers, unknowns, document checklist and evidence-gathering actions.
- Operational notes for email setup, privacy boundaries and the limits of browser-native voice.

## What the report means (and does not mean)

The current report generator is deliberately conservative. It records answers as owner-reported and not independently verified, identifies unanswered required questions, and marks documents as not provided/verified unless a separate review proves otherwise. It does not claim that it has diagnosed the business, verified financials, or built a final brand-specific transformation plan. It uses no external AI API.

## Historical validation snapshot (before canonical runtime mapping)

- Latest observed frontend validation on head `fc785236a6c41f430498fd919e00712b07e7b459`: **PASS** — GitHub Actions run `40491169293` completed the TypeScript check and Next.js production build successfully.
- Latest observed Edge Function validation on that head: **PASS** — run `40491169182` passed Deno type-check for invite, respondent, and private-report functions.
- Canonical questionnaire validation on that head: **FAIL BY DESIGN** — run `40491169493` rejects the non-canonical 234-question / 16-section / 14-item checklist draft. Do not bypass this gate.
- Supabase migration workflow: **BLOCKED** — run `40491169575` failed at `Check required Supabase secrets`; all setup/link/preview/apply steps were skipped. No migration was applied.
- Production migration drift check: **PASS** — run `40491169181`; this is not a substitute for applying/testing the new migration in non-production.
- Vercel deployment status: **FAILURE DUE TO BUILD-RATE QUOTA** — this does not establish a source build failure. No deployment was made by this pass.
- End-to-end security, email delivery and actual respondent journey: **NOT TESTED** in a non-production environment.

## Historical blockers before canonical runtime mapping

1. **Source recovery is complete; runtime reconciliation is not.** The original source is stored at `docs/brand-discovery/source/RAAHAT_OWNER_DISCOVERY_QUESTIONNAIRE_ORIGINAL.txt`. A loss-preserving structural extraction is stored at `docs/brand-discovery/source/RAAHAT_SOURCE_TRANSCRIPTION_V1.json`, and the comparison report is `docs/brand-discovery/RAAHAT_SOURCE_RECONCILIATION_REPORT.md`. The recovered source has 16 sections, 235 numbered question headings, and 20 checklist items. The separate 234-question replacement draft is still not canonical and must not be activated. The validator must continue to fail until source blocks, choice rules, multi-part questions, declarations, and checklist are mapped and reviewed against the runtime schema.
2. **No active questionnaire template exists by default.** The invitation UI intentionally refuses to create an invitation without an active, reviewed template. Do not activate the non-canonical draft.
3. **The exact questionnaire cannot be tested end-to-end yet.** Once canonical wording is mapped into the runtime bank, test all answer types, select-all / select-up-to-N rules, optional explanations, resume pointer, final submission and completion checks.
4. **Email is code-complete but configuration-dependent and unverified.** Provider, verified sender domain, privacy notice, and FK report mailbox need approval. No emails have been sent by this implementation pass.
5. **No deployed non-production integration/security test has been run.** The new Edge Functions, migration, CORS, JWT and staff allowlist must be tested in a non-production environment.
6. **Voice is a browser-native prototype, not the requested conversational AI guide.** Read-aloud and a few voice commands are included. Natural Hinglish conversation / clarification needs separate design and approval; do not add paid AI without explicit approval.
7. **The staff workspace relies on the existing Supabase sign-in flow.** Confirm the route, staff allowlist and session persistence in the actual FK deployment.

## Server-side settings (configure only after approval)

- `RESEND_API_KEY`
- `BRAND_DISCOVERY_EMAIL_FROM`
- `BRAND_DISCOVERY_PUBLIC_ORIGIN`
- `BRAND_DISCOVERY_ALLOWED_ORIGIN` (exact origin, no wildcard)
- `FK_BRAND_DISCOVERY_REPORT_EMAIL`
- `FK_BRAND_DISCOVERY_ADMIN_EMAILS` (comma-separated staff email allowlist)

Never place these secrets in frontend variables or commit them. The source code does not contain a mail API key. No production database migration or Edge Function deployment was performed.

## Latest verification snapshot

Observed PR head at the time of this snapshot: `fc785236a6c41f430498fd919e00712b07e7b459`. PR #191 remains open, draft, unmerged and undeployed. The frontend and Edge Function checks passed for this head; the canonical-source gate intentionally failed; the migration workflow stopped before any migration action because required secrets are absent. Vercel preview deployment was separately blocked by the free-plan daily deployment quota, so no new deployment is claimed.

## Earlier safe-next-gate plan (superseded by the addendum below)

Use the recovered source in the feature branch → encode and reconcile all 235 question headings, exact wording/options/selection rules/20-item checklist/declarations → run the fail-closed validator → run frontend and Edge Function CI → apply migration only to a non-production project after authorized secret configuration → test invite/save/resume/edit/submit/email/report privacy → review accessibility and browser voice support → only then consider production approval.


## Later update — canonical source mapping pass

The earlier handoff snapshot above predates the latest mapping work. The runtime questionnaire is now mapped to the recovered source and remains inactive as a draft.

- 16 sections and 235 section-local question headings are mapped.
- The automated validator compares exact prompts/source blocks, option order, selection rules, complex control structures, checklist and declaration.
- The respondent flow now includes ten multi-part questions, per-service operational statuses, repeatable named hall-capacity rows, the 20-item document checklist, and owner acknowledgement.
- Questionnaire validation and Edge Function type-check passed on the latest observed implementation head; the frontend build was still running when this note was prepared.
- Human semantic review, end-to-end security/access testing, accessibility review and non-production integration testing remain required.
- The PR remains draft/open; no production migration, deployment, activation or email delivery has occurred.


## Current continuation update — 28 October 2026

- Canonical runtime mapping is present: 16 sections, 235 source questions, 20 checklist items; automated source-mapping checks passed on commit `3bf032d36160df95e20aa53347601a4389e56dbe`.
- The respondent form now supports optional “Other” clarification fields across simple choice, multipart and service-status controls. The canonical question and option labels are not rewritten. The validator was extended to enforce this coverage.
- The first CI run after that extension (commit `65a099fda954ef0785b1a1fac94c83d01d8b8567`) correctly caught missing clarification metadata for options whose labels start with “Other” plus extra text. The bank was corrected and the docs updated; latest observed head at this addendum is `b433d93978f512e4c6b9b833fc307656eac6d076`. A completed CI result for that exact head has not yet been observed.
- On commit `3bf032d36160df95e20aa53347601a4389e56dbe`, frontend type-check/build and Edge Function type-check passed; questionnaire mapping validation passed. The migration workflow still fails at the prerequisite check for missing Supabase secrets and skips every migration action. No migration was applied.
- The template remains `draft`; no merge, activation, production deployment, email delivery or paid AI call occurred.

## Still required before calling the product complete

1. Confirm questionnaire validation, frontend build and Edge Function checks on the newest commit.
2. Run a full non-production journey: invite, open, answer each answer type, select/deselect Other, autosave, close, resume at the exact point, back/edit, finish checklist, acknowledge, submit, and inspect the private FK report.
3. Test invalid/expired links, malformed or over-limit choices, missing multipart answers, service-status gaps, incomplete checklist, and respondent denial from private reports.
4. Complete semantic review of inferred room-category and monthly occupancy controls and questions where options may not capture the full business fact requested.
5. Complete keyboard/screen-reader/mobile review and approve privacy/email settings.
6. Configure authorized secrets and obtain explicit approval before any non-production migration/deployment or email test. Production remains untouched.


## Latest verification correction — 28 October 2026

The latest observed branch head is `4a19862966d77b4dc9ea4fe5f91e3f3a13d4344b`.

- Brand Discovery Questionnaire Validation: **PASS** (run `40637468872`).
- Brand Discovery Edge Function Validation: **PASS** (run `40637469062`).
- Brand Discovery Frontend Validation: **PASS** (run `40637469032`, TypeScript check and Next.js production build).
- Production migration drift check: **PASS** (run `40637468876`).
- Supabase migration workflow: **BLOCKED/FAILED at required-secret preflight** (run `40637468869`); CLI setup, project link, preview and apply steps were skipped. No migration was applied.

The automated checks pass for the latest observed head, including the new optional “Other” clarification controls. This is not end-to-end acceptance. The PR remains draft/open/unmerged; the template remains inactive; no deployment, email or paid AI call occurred. The non-production integration/security journey and human semantic/accessibility review remain release blockers.
