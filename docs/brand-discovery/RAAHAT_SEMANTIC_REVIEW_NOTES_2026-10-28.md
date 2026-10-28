# Raahat Questionnaire — Semantic Review Notes

**Status:** AI-assisted review completed; **Franchise Kart owner approval still required**. This document is not a release approval.
**Reviewed:** 28 October 2026
**Canonical source:** `docs/brand-discovery/source/RAAHAT_OWNER_DISCOVERY_QUESTIONNAIRE_ORIGINAL.txt`
**Runtime template:** `config/brand-discovery/raahat-question-bank-v1.draft.json`

## Review boundary

This review checks whether the mapped controls can be understood without changing the recovered questionnaire's wording or silently inventing business facts. It does not certify the source as commercially complete, and it does not replace a review by the FK project owner or Mr. Chitwan.

## Findings and required decisions

### SR-01 — Room category and rate capture

**Risk:** The source asks for room rates by category, while the runtime mapping uses a predefined room-category control. The source may not define every category actually used by Raahat.

**Safe handling:** Preserve every source-defined category and provide an explicit “Other” path with a separate optional clarification. Do not force the owner into a category that does not fit. If the current UI cannot accept an owner-defined category, treat this as a release blocker.

**Approval required:** FK confirms the category list matches Raahat's actual inventory or approves the “Other” route as sufficient.

### SR-02 — Month-by-month occupancy

**Risk:** The source asks about occupancy for each month, while a short instruction says “Select one.” A single answer for the whole year would lose the requested monthly detail.

**Safe handling:** Capture one response per month, label each month explicitly, and preserve “Not sure / records unavailable” only where supported by the source choices. Do not infer occupancy percentages from categorical answers. If the source does not supply numeric ranges or a suitable “unknown” choice for a month, flag that gap for FK approval rather than adding a new source option silently.

**Approval required:** FK confirms the monthly grid faithfully expresses the source's intent.

### SR-03 — Questions asking for business facts where choices describe records

**Risk:** Some prompts request detailed numeric or operational facts, but the available choices appear to describe records, categories, or availability. A selected “records available” option is not the underlying financial or operating figure.

**Safe handling:** Store the chosen source option as a self-reported answer only. Do not treat it as a numeric value, verified evidence, or a basis for margin/occupancy calculations. Where the source requests an actual figure but the form has no way to capture it, list it as a discovery gap for the follow-up interview; do not silently substitute a new field into the canonical source mapping.

**Approval required:** FK decides whether a versioned follow-up field should be added in a later template version.

### SR-04 — “Other” clarification

**Risk:** A selected “Other” option can be ambiguous without explanation.

**Safe handling:** The supplemental clarification is optional, appears only after an applicable “Other” choice, and must be stored separately from the canonical choice. It must not replace, reorder, or rewrite the source prompt/options. Do not require a clarification when the owner selects “Prefer to discuss personally” unless FK explicitly approves that behavior.

**Verification needed:** Confirm the frontend and server both preserve the clarification across save, resume, edit and submission.

### SR-05 — Evidence status versus owner statement

**Risk:** Owner answers and document checklist selections may be mistaken for verified facts.

**Safe handling:** Label questionnaire answers as **owner-reported, not yet verified**. Checklist responses indicate reported availability only—not that a file was received, reviewed, authentic or reconciled. The private report must keep “reported”, “received”, “reviewed” and “verified” as distinct states. Do not generate financial conclusions or brand-specific diagnoses from unverified answers alone.

**Approval required:** FK approves the private report's evidence labels and follow-up workflow before release.

### SR-06 — Voice, language and accessibility

**Risk:** Browser-native speech features do not guarantee natural Hindi/Hinglish conversation, accurate speech recognition, or accessible operation across devices.

**Safe handling:** Describe voice as an optional browser-dependent prototype until tested. Keyboard-only completion, readable focus state, small-screen layout, clear save/error feedback and a non-voice completion path are required. Do not advertise a conversational AI guide as complete.

**Verification needed:** Test supported desktop/mobile browsers and screen-reader/keyboard use before release.

## Release decision

**Not approved for activation.** The following remain hard gates:

1. FK owner reviews SR-01 through SR-06 and records acceptance or a versioned change decision.
2. CI is checked against the current PR head, not a previous commit.
3. In an authorized non-production Supabase project, test invitation, open, answer, autosave, close, exact resume, back/edit, checklist, acknowledgement, submission and private FK report.
4. Run negative security tests for expired/invalid tokens, altered and duplicate answers, incomplete submissions, unauthorized staff, respondent access to private reports, and restrictive CORS/RLS.
5. Verify no service-role key is exposed to the browser and no secrets are committed or pasted into chat.
6. Review email sender/provider, privacy copy, accessibility and the release checklist.
7. Obtain explicit release approval before migration, deployment, activation or sending invitations.

The existing workflow's missing-secret failure is a pre-migration block. Do not bypass it, add placeholder secrets, apply migrations to production, or use Vercel quota exhaustion as a reason to merge without the required checks.

## Current evidence snapshot

At the review point, PR #191 is draft/open/unmerged. The current observed head has passing questionnaire, frontend and Edge Function validation workflows; migration deployment failed at the required-secret check before applying a migration. Vercel deployment checks are pending/blocked by the free daily deployment quota, and an unrelated GoMax deployment check is failing. These statuses do not prove the Raahat end-to-end journey or production readiness.
