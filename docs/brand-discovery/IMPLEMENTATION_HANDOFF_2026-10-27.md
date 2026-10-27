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

## Validation results from the implementation pass

- Frontend validation workflow: **PASS** — TypeScript check and Next.js production build succeeded on this branch.
- Edge Function validation workflow: **PASS** — invite, respondent, and new private-report Edge Functions passed Deno type-check.
- Canonical questionnaire validation workflow: **FAIL BY DESIGN** — strict validator rejects the non-canonical 234-question / 16-section / 14-item checklist draft.
- Supabase migration workflow: **BLOCKED** — required GitHub Actions secrets are absent; the workflow stopped before linking or applying any migration.
- Vercel deployment status: **FAILURE DUE TO BUILD-RATE QUOTA** — this does not establish a source build failure. No deployment was made by this pass.
- End-to-end security, email delivery and actual respondent journey: **NOT TESTED** in a non-production environment.

## Hard blockers to real completion

1. **Canonical Raahat source is not yet transcribed into the repository.** The user did provide the exact 95-question source in a prior conversation; available working context confirms that fact but does not expose the complete literal message for safe transcription in this pass. The only encoded questionnaire is a clearly labelled 234-question replacement draft with 16 sections and 14 checklist items. It is not the canonical original. Do not claim the user never supplied it, and do not fabricate a substitute. The fail-closed validator must continue to fail until the exact source is transcribed and reconciled.
2. **No active questionnaire template exists by default.** The invitation UI intentionally refuses to create an invitation without an active, reviewed template. Do not activate the non-canonical draft.
3. **The exact questionnaire cannot be tested end-to-end yet.** Once canonical wording is recovered, test all answer types, select-all / select-up-to-N rules, optional explanations, resume pointer, final submission and completion checks.
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

## Safe next gate

Recover the canonical 95-question source → encode and reconcile exact wording/options/selection rules/checklist/declarations → run the fail-closed validator → run frontend and Edge Function CI → apply migration only to a non-production project → test invite/save/resume/edit/submit/email/report privacy → review accessibility and browser voice support → only then consider production approval.
