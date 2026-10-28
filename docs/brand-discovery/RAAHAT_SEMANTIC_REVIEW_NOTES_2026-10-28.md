# Raahat Questionnaire — Semantic Review Notes

**Status:** Owner semantic decisions recorded for SR-01–SR-06; implementation verification and release approval remain outstanding. This document is not a release approval.
**Reviewed:** 28 October 2026
**Owner decisions recorded:** 28 October 2026, based on explicit Franchise Kart owner authorization in the project conversation.
**Canonical source:** `docs/brand-discovery/source/RAAHAT_OWNER_DISCOVERY_QUESTIONNAIRE_ORIGINAL.txt`
**Runtime template:** `config/brand-discovery/raahat-question-bank-v1.draft.json`

## Review boundary

This review checks whether the mapped controls can be understood without changing the recovered questionnaire's wording or silently inventing business facts. It does not certify the source as commercially complete, and it does not replace technical verification or release approval. The decisions below authorize implementation of the stated handling rules; they do not authorize production changes, invitations, email sending, or release.

## Findings and owner decisions

### SR-01 — Room category and rate capture

**Owner decision: APPROVED.**

Preserve all source-defined categories and add an explicit “Other” path with a separate optional clarification. Do not force the owner into a category that does not fit. The UI must retain the canonical selected option and clarification separately.

**Verification still required:** Confirm the actual control, persistence, resume/edit behavior, and source validator implement this decision without changing source wording/options.

### SR-02 — Month-by-month occupancy

**Owner decision: APPROVED.**

Capture each of the 12 months separately and preserve source-defined options. Do not infer or fabricate percentages. If a month lacks a suitable source-defined choice or the available choices cannot represent the answer faithfully, flag that gap for an explicit FK decision rather than silently inventing a choice.

**Verification still required:** Confirm 12 individually labelled month controls, per-month persistence/validation, and no inferred numeric values.

### SR-03 — Business facts versus record availability

**Owner decision: APPROVED.**

Store source choices as self-reported answers only. “Records available” or similar choices must never be treated as the underlying business figure, verified evidence, or a basis for financial/operational calculations. Flag missing numeric or operational facts for follow-up. Any added field requires an explicit FK decision and a versioned template change; do not silently alter the canonical source mapping.

**Verification still required:** Inspect report generation, data model, and validation for any unsupported conversion from categorical answers to numeric or verified facts.

### SR-04 — “Other” clarification

**Owner decision: APPROVED.**

Show a separate optional clarification only after an applicable “Other” selection. Store it separately from the canonical selected option and preserve source prompt/options unchanged. Do not require clarification for “Prefer to discuss personally.”

**Verification still required:** Test simple-choice, multipart and service-status controls, including save, resume, edit and submit. Confirm the clarification never replaces or mutates the canonical answer.

### SR-05 — Evidence status versus owner statement

**Owner decision: APPROVED.**

Label owner responses as **self-reported / not yet verified**. Keep **reported**, **received**, **reviewed** and **verified** as distinct statuses. A document-availability selection must not imply that a document was received, reviewed, authenticated or reconciled. Do not present unverified answers as proven business conclusions.

**Verification still required:** Review the private report and workflow state transitions; confirm report labels and evidence status are distinct and no unsupported diagnosis is generated.

### SR-06 — Voice, language and accessibility

**Owner decision: APPROVED.**

Voice is optional. Describe browser-native speech recognition/read-aloud accurately as a browser-dependent voice-input/read-aloud prototype, not a conversational AI guide. The complete questionnaire must work without voice or microphone permission.

**Verification still required:** Test keyboard navigation, visible focus, labels, screen-reader behavior, readable validation/errors, desktop and mobile browsers, save/resume, and clear validation/submission feedback.

## Release decision

**Not approved for activation or release.** Owner semantic decisions are recorded, but implementation verification and the following gates remain open:

1. Verify the implementation against SR-01 through SR-06, and record any unresolved source gaps for explicit FK decision.
2. Confirm CI against the current PR head SHA, not an earlier commit.
3. In an explicitly authorized non-production Supabase project, test invitation, open, answer, autosave, close, exact resume, back/edit, checklist, acknowledgement, submission and private FK report.
4. Run negative security tests for expired/invalid tokens, altered and duplicate answers, incomplete submissions, unauthorized staff, respondent access to private reports, and restrictive CORS/RLS.
5. Verify no service-role key is exposed to the browser and no secrets are committed or pasted into chat.
6. Review email sender/provider, privacy copy, accessibility and the release checklist.
7. Obtain separate explicit release approval before migration, deployment, activation or sending invitations.

The missing-secret workflow failure is a pre-migration block. Do not bypass it, add placeholder secrets, apply migrations to production, or use Vercel quota exhaustion as a reason to merge without required checks. Configure secrets only through the approved secret manager, with authorized access.

## Current evidence snapshot

At the latest evidence refresh before this note update, PR #191 remained draft/open/unmerged. Questionnaire source validation passed on head `b37f37077425976b1e25f8ca503ede80577823db`; frontend and Edge Function validation were still in progress and must be checked again after this documentation commit. The Supabase migration workflow failed at the required-secret check before applying a migration. This is not evidence of a successful migration or end-to-end journey. Vercel quota blocks and unrelated GoMax checks are not evidence of Raahat readiness.

No production migration, deployment, activation, invitation/email sending, or paid AI use is authorized by these semantic decisions.


## Implementation follow-up — room-rate Other category

A targeted draft-branch fix has now been committed: the “Other category” room-rate row is marked optional, the instructions tell the respondent to leave it blank when no additional category exists, and an optional separate clarification is shown only when that row is answered. The respondent completion check and Edge Function multipart validator were adjusted to allow that optional part, and the source validator now asserts the behavior. **This is code presence, not yet verified acceptance.** Current-head CI and non-production persistence/submit tests must pass before this fix can be accepted.


## Implementation follow-up — private evidence report

The draft branch now formats selected option IDs as their human-readable labels in the private report, including multipart and service-status answers. The document checklist report separates respondent-reported availability from receipt confirmation, review status and verification status. This code has not yet passed the latest Edge Function validation or non-production report/access-control tests; do not treat it as release accepted.
