# Brand Discovery — Email and Private Report Operations

Status: implementation draft. Nothing in this document means email or the platform is live.

## Optional email provider

The invite and respondent Edge Functions support Resend through server-side environment variables. No key is included in source code.

Configure only after Franchise Kart approves the provider, sender domain, email copy, recipient policy, privacy notice, and sending limits:

- `RESEND_API_KEY`: Resend API key stored as a Supabase Edge Function secret.
- `BRAND_DISCOVERY_EMAIL_FROM`: verified sender, for example a name and address on a domain FK controls.
- `BRAND_DISCOVERY_PUBLIC_ORIGIN`: exact HTTPS origin where the respondent page is deployed; no trailing path.
- `BRAND_DISCOVERY_ALLOWED_ORIGIN`: the same exact origin for CORS.
- `FK_BRAND_DISCOVERY_REPORT_EMAIL`: private Franchise Kart notification mailbox.
- `FK_BRAND_DISCOVERY_ADMIN_EMAILS`: comma-separated allowlist of staff email addresses allowed to invite and read private reports.

Never place any secret in a frontend environment variable, repository, prompt, or chat. Do not configure these values until the provider, sender domain and privacy terms are approved.

### Email behaviour

- Invitation email contains the private resume link. Anyone holding the link may access the respondent questionnaire until it expires; the owner must keep it private.
- Submission sends the respondent a completion confirmation and FK a separate notification. The FK email contains a submission ID and directs staff to the authenticated report flow; it does not include private analysis.
- If the required mail settings are absent, email delivery is reported as `not_configured`. If the provider rejects a request, it is reported as `failed`. Do not interpret an HTTP-accepted email as proof of inbox delivery.
- Email delivery is not yet end-to-end verified in a deployed non-production environment.

## Private report endpoint

`brand-discovery-private-report` requires a valid Supabase user JWT and the explicit FK email allowlist. It supports:
- `{ "action": "list" }` — list recently submitted sessions, with no answers.
- `{ "action": "get_report", "session_id": "<uuid>" }` — build and return the private evidence-first report for a submitted session.

The report deliberately does not call a paid or external AI service. It labels stored answers as owner-reported and unverified, lists required unanswered questions and marks the configured document checklist as not provided/verified unless a separate evidence-review workflow records actual receipt and verification. Its initial action plan is only a set of evidence-gathering steps, not a brand-specific diagnosis.

The respondent endpoint does not query or return the private report table. This separation still needs integration testing in a non-production Supabase project before release.

## Voice experience

The respondent page includes browser-native read-aloud and basic voice commands (repeat, previous, next, stop) where the browser supports them. Speech recognition availability and Hindi/Hinglish accuracy vary by browser, device and permissions. This is a no-additional-API-cost accessibility prototype; it is **not** an AI conversation guide and does not yet answer free-form business questions. Do not advertise it as a fully conversational AI voice agent.

## Not complete / release blockers

- Canonical Raahat question bank: the exact source must be transcribed and reconciled before the validator can pass.
- Private report staff UI and evidence-upload/review workflow.
- Real integration/security tests for invite → save → resume → edit → submit → emails → staff-only report.
- Email provider and sender approval/configuration.
- Non-production database migration and function deployment tests.
- Accessibility review for animation and speech controls.
- Human review of any brand-specific diagnosis and transformation plan.

Do not merge, migrate, deploy, activate, or enable paid AI based on this draft alone.
