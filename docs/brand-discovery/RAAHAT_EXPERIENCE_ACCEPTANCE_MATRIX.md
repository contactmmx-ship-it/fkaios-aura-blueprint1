# Raahat Brand Discovery — Experience Acceptance Matrix

**Status:** Implementation in progress; not a release approval.  
**Branch / PR:** `feature/brand-discovery-foundation` / [PR #191](https://github.com/contactmmx-ship-it/fkaios-aura-blueprint1/pull/191)  
**Rule:** Code presence is not end-to-end acceptance. Keep draft, inactive and unmerged until the release gates pass.

## Current source-of-truth implementation

### Respondent experience

| Capability | Code state | Acceptance still required |
|---|---|---|
| Premium visual language, welcome screen, guided introduction | Implemented in preview | Visual/usability review across mobile and desktop |
| 16 sections and 235 canonical question headings | Mapped from recovered source; validator exists | Current-head CI pass and semantic review |
| One question at a time, section navigation and progress | Implemented | End-to-end journey and accessibility testing |
| Choice, multi-select, multipart, service-status and repeatable capacity controls | Implemented with server validation | Invalid-input and boundary tests |
| Back/edit, local autosave/resume, welcome-back state | Implemented in browser preview; server-side token/session path also exists in branch | Exact-point restore, close/reopen, server persistence and conflict tests |
| Review answers and jump back to edit | Added to preview UI | Test all question types and answer rendering |
| Required-answer and acknowledgement gates | Added to preview UI | Confirm frontend/server validation parity |
| Supporting-document checklist (20 items) | Implemented as availability checklist | End-to-end persistence; this is not a document-upload system |
| JSON export and print/save-as-PDF | Added to browser preview | Browser/device test; exported file must remain clearly marked as preview data |
| Browser-native read-aloud / basic voice commands and dictation | Prototype only | Browser/device, permissions, keyboard and language testing |
| Contextual discovery-guide chat | UI and API route added | Current-head CI; verify local fallback and the disabled-by-default gate |
| Natural conversational AI guide in Hindi, English and Hinglish | Architecture is opt-in through the server route; **not active by default** | Explicit model/cost approval, approved model configuration, security and language QA |
| Secure document upload | Not implemented | Private storage design, access control, file limits, validation, malware-safe handling, retention and audit |
| Animation and accessibility | Some motion and ARIA feedback in code | Keyboard-only, focus, screen-reader, reduced-motion, zoom/reflow and mobile review |

## Server-side platform already present in the branch

| Capability | Code state | Acceptance still required |
|---|---|---|
| Versioned questionnaire/session/answer/private-report persistence foundation | Migration and Edge Function code in branch | Approved non-production migration and persistence tests |
| Hashed high-entropy resume tokens and invite endpoint | Code in branch | Invalid/expired/revoked token and abuse tests |
| Server-side answer/choice/closure validation | Code in respondent Edge Function | Negative test matrix and client/server parity |
| Completion email and FK notification | Optional Resend integration in code | Approved provider, sender, recipients, templates, retries/idempotency and explicit send approval |
| Authenticated FK private-report endpoint and staff workspace | Code in branch | Non-production staff allowlist/access-control tests |
| Evidence-first report and evidence-state distinctions | Deterministic report generator in branch | Reviewer workflow and test that no owner can read internal report |
| Private diagnosis and transformation plan | **Not a completed brand-specific diagnosis.** Report is conservative and action-draft oriented. | Evidence-backed analysis workflow, named accountable owners, baselines, targets, dates, dependencies, verification methods and human sign-off |
| Reusable versioned brand/category template foundation | Code in branch; active-template gate is fail-closed | New-template tests and human approval workflow |
| Production/non-production deployment | Not verified for current head; live deployment not authorised | Approved non-production environment, secrets via approved secret manager, successful deploy and E2E test |

## Contextual guide behaviour and cost controls

- The guide API returns contextual, rule-based local guidance when the feature is not explicitly enabled.
- A model call is attempted only when all three server-side settings exist: `FKAIOS_BRAND_DISCOVERY_AI_ENABLED=true`, `AI_GATEWAY_API_KEY`, and `FKAIOS_BRAND_DISCOVERY_MODEL`.
- No default model is selected; this prevents accidental model usage from a code deploy alone.
- The browser never receives the gateway key.
- AI replies must not invent facts, mark owner statements as verified, expose the private report, or claim to submit/save/send anything.
- No AI service has been enabled by this code change and no paid AI request has been made.

## Non-negotiable data semantics

1. Owner answers remain **self-reported** unless independently verified.
2. Document “availability” is not the same as receipt, review or verification.
3. Missing numbers and operational facts must be flagged for follow-up, never inferred.
4. “Other” clarification remains separate from the canonical option; do not rewrite the source question or options without an approved versioned change.
5. The internal FK report must never be rendered or emailed to the respondent.
6. No production migration, function deployment, activation, invitation/email sending, or paid AI usage without explicit approval.

## Release gates

- [ ] Current-head questionnaire validation passes.
- [ ] Current-head frontend type-check and production build pass, including the preview page and guide API.
- [ ] Current-head Edge Function type-check passes.
- [ ] Non-production invite → open → answer/autosave → close/resume → back/edit → checklist/acknowledgement → submit → completion notification → private FK report test passes.
- [ ] Invalid/expired tokens, altered options, duplicate/over-limit choices, incomplete multipart/service-status/capacity answers, invalid closure, CORS and non-allowlisted staff are rejected.
- [ ] Owner cannot access FK report or execution plan.
- [ ] Keyboard, screen-reader, reduced-motion and mobile/desktop QA passes.
- [ ] Upload capability is either explicitly deferred or implemented and tested before it is advertised as available.
- [ ] Any AI model, spend limit, provider data handling and voice behaviour are approved before enabling.
- [ ] Rajeev explicitly approves activation after reviewing the tested preview.

**Current delivery note (28 October 2026):** The preview now includes a premium welcome journey, saved-stage resume, welcome-back notice, required-answer gates, completion review/edit, local export/print, optional dictation and a contextual guide panel/API with no-spend default. The frontend validation workflow was expanded to include the preview route, guide API and static preview files. Vercel's daily deployment limit is still blocking new deployment statuses; this is not evidence of a source build pass or failure. No production changes have been made.


## Reusable template hardening — 28 October 2026

- The active-template gate is now generic across brands and validates JSON/database identity, question and section IDs, control-specific option structure, declared counts, checklist structure, eight review flags and a recorded human approval. Raahat keeps its stricter canonical source gate.
- Draft templates can be validated offline with `node scripts/validate-brand-discovery-template.mjs <file.json>`. The generic seeder accepts a future-brand filename and only writes a draft row. Activation is separate and requires explicit confirmation plus the same release gate; neither script was executed against a database in this work.
- Respondent saves now validate each answer's type/choice set before persistence, check section/question pointer consistency and reject oversized request bodies. The closure checklist count is template-defined rather than fixed at 20.
- Invitation and completion email sends are disabled by default behind an explicit server-side enable flag.
- CI passed on code commit `7985e21025e7b287f3f8631db7e90c848d1f4996` for questionnaire validation, frontend build/type-check, Edge Function type-check and migration drift. This includes identity binding, shared answer/closure validator tests, and reusable template provenance checks.

These improvements close reusable-schema and validation gaps, not the release gate. Non-production database/function deployment, end-to-end persistence and access-control testing, accessibility/device QA, and any required secure document upload remain unverified. Do not activate or merge based on unit tests alone.
