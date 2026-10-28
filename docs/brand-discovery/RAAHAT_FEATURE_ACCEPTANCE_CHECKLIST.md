# Raahat × Franchise Kart — Feature Acceptance Checklist

Status: requirements baseline; not a release approval.

## Canonical source requirements — hard gate
- [x] Use the owner's supplied source document/message as the only canonical wording source; the recovered source is preserved in the repository.
- [x] Preserve the canonical source's 16 numbered sections and all 235 numbered question headings in the original order; numbering is section-local.
- [x] Automated validator compares all 235 exact question prompts/source blocks, source options/order, section-local numbering, and selection instructions; human semantic review remains required.
- [x] Preserve the original 20-item checklist and declaration/confidentiality/sign-off/next-step wording in runtime configuration; checklist and acknowledgement UI is implemented (end-to-end persistence still needs testing).
- [x] Encode source selection modes and limits in the runtime mapping; interactive end-to-end testing remains pending.
- [x] Preserve source “Other” choices and provide a separate optional clarification field when an “Other” option is selected; the canonical prompt and options remain unchanged. Automated coverage includes simple choices, multipart questions, and service inventory.
- [x] Automated validator rejects section/question order and count mismatches, missing/duplicate IDs, altered option order/selection limits, and a checklist count other than 20; exact CI result must be confirmed on the latest commit.
- [x] Keep the current source-mapped draft inactive until semantic review, end-to-end tests, security review, and explicit release approval pass.
- [x] Record 235 source question headings after comparing against the recovered canonical source.

## Respondent experience
- [x] Welcome/introduction and clear instructions are present in code; usability/accessibility review remains pending.
- [x] One question at a time, with accessible radio/checkbox/text controls (code present; accessibility review pending).
- [x] Implement single choice, multiple choice, select-up-to-N, multipart controls, per-service status controls, and repeatable hall-capacity rows; test the journey before release.
- [x] Back/forward navigation and ability to edit previous answers (code present; journey test pending).
- [x] Visible section and overall progress; clear section and final completion states (code present; journey test pending).
- [x] Persistent autosave/manual-save behaviour with save/error feedback (code present; non-production persistence test pending).
- [x] Secure resume link; restore saved answers and resume pointer (code present; exact-point end-to-end test pending).
- [ ] Plain-language clarification for misunderstood questions without changing the canonical question or answer options.
- [ ] Hindi, English, and natural Hinglish response support.
- [ ] Voice interaction/navigation is a product requirement; do not claim it is implemented until end-to-end tested.
- [ ] Motion/animated progress should remain accessible and must not obstruct keyboard or screen-reader use.

## Owner communication and privacy
- [ ] Owner receives the approved invitation and secure respondent link.
- [ ] Owner can see their own answers and progress only.
- [ ] On successful completion, send the approved congratulations/completion email only.
- [ ] Do not email or expose Franchise Kart's internal diagnosis, SWOT, recommendations, or execution plan to the owner.
- [ ] Do not enable email delivery until a provider, sender identity, template, and sending policy are approved.

## Franchise Kart private workflow
- [x] Authenticated staff invitation with explicit email allowlist (code present; non-production security test pending).
- [x] Private view of submitted answers and document checklist status (initial staff workspace present; evidence-review workflow remains incomplete).
- [ ] Separate documented statuses for received, missing, unclear, and needing verification.
- [ ] Analysis distinguishes owner statements, verified evidence, and AI-generated hypotheses.
- [ ] Diagnosis covers only what the answers/evidence support; no invented financials or unsupported promises.
- [ ] Transformation plan includes priorities, measurable targets, actions, timeline, accountable owner, dependencies, and verification method.
- [x] Private report endpoint requires JWT and staff email allowlist; respondent endpoint does not return reports (integration/security test pending).
- [x] Reusable questionnaire/template architecture is versioned and configuration-driven; active-template gate exists (canonical Raahat template still blocked).

## Security, data integrity, and reliability
- [ ] Store only a hash of high-entropy resume tokens; never log or expose raw tokens.
- [x] Token/session/version checks and server-side validation for choices, selection limits, multipart answers, per-service statuses, repeatable capacity rows, and closure fields are present; end-to-end security testing remains pending.
- [ ] Reject duplicate selections, invalid options, wrong selection mode, and exceeding max selections.
- [ ] Persist answers and exact resume pointer; reject edits/submission after session submission.
- [ ] Validate submission completeness server-side.
- [ ] No service-role key in browser bundles.
- [ ] Restrictive CORS with exact production origin.
- [ ] RLS and staff/owner access controls tested in a non-production environment.
- [ ] Audit logging avoids secrets and unnecessary sensitive answer contents.
- [ ] No production migration, Edge Function deployment, email sending, paid AI usage, or activation without explicit approval and passing checks.

## Reusable brand templates
- [x] Questionnaire content is versioned/configuration-driven, not embedded in respondent UI.
- [x] The current template remains draft and is not release-approved; the invite flow only serves active templates. Test the activation gate before release.
- [ ] New-brand questions may be drafted with AI, but require human approval and must not overwrite an approved source.
- [ ] Document checklist and report sections can vary by approved brand/category template.

## Required validation evidence before release
- [x] Automated source reconciliation report covers 16 sections, 235 numbered question headings, 20 supporting-document checklist items, exact question/source blocks, option wording/order and mapped selection rules; human semantic review remains pending.
- [x] Frontend type-check and production build pass (GitHub Actions run 40475218603).
- [x] Edge Function type-check passes (GitHub Actions run 40475218702).
- [x] Automated source-mapping validator compares the canonical bank against the recovered source; a passing mapping check is not release approval.
- [ ] Integration/security matrix passes in a non-production environment.
- [ ] End-to-end test covers invite → open → answer → save → close → resume → edit → submit → private FK review → owner completion email.
- [ ] Review confirms no owner access to internal FK analysis or execution plan.
- [x] PR remains draft/open and unmerged until all checks and required release approval are complete.

## Implementation status update — 27 October 2026

Code presence is not the same as release acceptance. Checked items above mean the described foundation exists in the branch; their annotations retain the required end-to-end verification caveat.

- Frontend validation PASS.
- Edge Function validation PASS.
- Questionnaire validation now compares the runtime draft against the recovered source and passes when source wording/options/selection rules/checklist mapping match. A pass does not approve activation.
- Migration workflow is blocked before any migration is applied because required GitHub Actions Supabase secrets are absent.
- Vercel build-rate quota is exhausted; this is not a source-code compilation result.
- No non-production end-to-end journey or access-control test has been run.
- The canonical questionnaire is preserved in the repository. The runtime draft now maps 16 sections, 235 numbered question headings, 20 supporting-document checklist items, complex selection controls, and acknowledgement UI. Automated source mapping is covered by CI; semantic review and end-to-end testing are still required. Do not activate the draft.

## Current known blockers at time this checklist was added
- The current runtime bank maps 235 source questions but remains a draft and must not be activated before review.
- Production migration and Edge Functions have not been deployed.
- GitHub Actions migration workflow is blocked by missing repository secrets; never paste secrets into chat.
- Vercel deployment quota has been exhausted; a deployment failure from quota exhaustion is not evidence of a source-code failure.
- Email delivery, private analysis/plan generation, private report UI, and full end-to-end security journey remain unverified or unfinished.


## Implementation status update — 27 October 2026 (source mapping pass)

- Canonical source-to-runtime validator compares exact question prompts and source blocks, option labels/order, selection modes/limits, complex-question structures, 20 checklist labels/order, and acknowledgement text.
- Complex answer handling includes ten multi-part questions, one service-by-service status matrix, and repeatable hall-capacity rows.
- The 20-item checklist and owner acknowledgement are included in the respondent flow and have a server-side final-submit gate.
- The template remains draft/inactive. The latest workflow run must be checked after the newest commits settle.
- No production migration, deployment, activation, or email delivery has occurred.
- Human semantic review is still needed for inferred room-category/monthly occupancy controls and questions where source options describe record availability rather than the underlying business figures.


## Clarification added — 28 October 2026

The runtime mapping is source-complete at the structural/automated level: 16 sections, 235 source questions, 20 checklist rows, 10 multipart controls, one service-status matrix, and one repeatable hall-capacity matrix. This is not equivalent to full product acceptance. The template remains inactive and release approval is withheld until optional “Other” explanations are addressed where required, semantic mappings are approved, CI is confirmed on the latest commit, and the non-production end-to-end/security/accessibility test matrix passes.


## Optional clarification control — 28 October 2026

The respondent UI now reveals an optional text field only when an `Other` / `Other…` choice is selected, including the service-status matrix and multipart questions. The response is stored alongside the selected answer; it does not replace or rewrite the source prompt or source options. The automated validator checks that every applicable answer control has the supplemental field. This remains a draft until the current CI run and non-production save/resume/submit journey pass.


## Owner semantic decisions — 28 October 2026

FK owner decisions SR-01–SR-06 have been explicitly approved and recorded in `RAAHAT_SEMANTIC_REVIEW_NOTES_2026-10-28.md`. This resolves the *decision* gate only; it does not certify that the current code fully implements each decision.

- [x] SR-01 decision: preserve source categories and provide an explicit optional Other path; do not force a category that does not fit.
- [x] SR-02 decision: capture each of the 12 months separately, retain source-defined choices, and do not infer percentages.
- [x] SR-03 decision: categorical answers remain self-reported; record availability is not the business figure or verified evidence; any added field needs explicit FK approval and a versioned template change.
- [x] SR-04 decision: optional Other clarification appears only when applicable, remains separate from the canonical choice, and is not required for “Prefer to discuss personally.”
- [x] SR-05 decision: reported, received, reviewed and verified remain distinct evidence states.
- [x] SR-06 decision: voice is optional and described as a browser-dependent prototype; the full flow must work without microphone access.
- [ ] Verify each decision in UI, persistence, server-side validation and private report; do not mark implementation accepted until tests pass.
- [ ] Current-head CI and authorized non-production end-to-end/security/accessibility checks remain release gates.

### Implementation audit note

The room-rate mapping now marks “Other category” optional, asks the respondent to leave it blank if no additional category exists, shows a separate optional category-name clarification when that row is answered, and lets respondents clear the optional selection. Client completion and server-side multipart validation have been updated. Static regression guards have been added to CI; non-production save/resume/submit testing is still required. Do not change canonical source wording/options to hide the gap.


## Status correction — 28 October 2026, latest branch state

- Owner semantic decisions SR-01–SR-06 are approved and recorded. Do not continue listing owner approval as outstanding.
- The room-rate optional-category behavior and private evidence-report labels/statuses have been implemented on the feature branch; acceptance still depends on CI and non-production integration tests.
- Voice is optional browser-based navigation for repeat/previous/next/stop, not a conversational AI guide. It must not block keyboard/on-screen use or be required for questionnaire completion.
- Questionnaire validation, frontend TypeScript/production build, and Edge Function type-check passed on the last observed PR head; recheck after the newest commits.
- The migration workflow still fails before applying anything because `SUPABASE_DB_PASSWORD` is missing from repository secrets; `SUPABASE_ACCESS_TOKEN` is already present. Vercel deployment checks are blocked by the free build-rate limit.
- No dedicated non-production Supabase branch currently exists. A development branch quote was returned at **US$0.01344/hour**. Do not create it until the user explicitly confirms this recurring cost.
- Production migration, Edge Function deployment, template activation, invitation/email sending, and merge remain blocked until the missing prerequisites and release checks are satisfied.


## Continuation update — 28 October 2026 (guided preview and validation)

The following work was added after the earlier status notes. These are implementation facts, not release approval:

- [x] Premium welcome journey in the preview, with plain-language expectations and an explicit preview-only privacy disclosure.
- [x] Browser preview persists the journey stage alongside responses and restores it on reload; displays a welcome-back notice when saved responses exist.
- [x] Required-question gate and final acknowledgement gate in the preview UI.
- [x] Completion-stage answer review with shortcuts to edit any of the 235 mapped questions.
- [x] Local JSON export and print/save-as-PDF action; the exported JSON identifies itself as preview-only and not submitted or verified.
- [x] Optional browser-native speech-to-text dictation for long text answers, with unsupported/permission-denied fallback.
- [x] Contextual Discovery Guide chat panel in both the Next.js preview and standalone preview.
- [x] Server-side guide route with a no-spend local guidance mode. A model request is made only if the server-side enable flag, AI Gateway key and explicit model ID are all present. No model default is supplied, and no AI call was made by this code change.
- [x] Optional browser speech playback for guide replies; this is browser-native speech, not natural AI voice generation.
- [x] Automated guide-safety test added to the frontend CI workflow; it checks the no-spend gate, server-only credentials, response bounds, timeout and fallback disclosures.
- [x] Frontend workflow now watches the preview route, guide API and standalone preview paths.

### Latest observed validation — commit `9dd22c4b63a57a346c6fa0c2ea99c301733f3423`

- Questionnaire source validation: **PASS** — [run](https://github.com/contactmmx-ship-it/fkaios-aura-blueprint1/actions/runs/40656784268).
- Frontend type-check, guide-safety test and Next.js production build: **PASS** — [run](https://github.com/contactmmx-ship-it/fkaios-aura-blueprint1/actions/runs/40656784087).
- Edge Function type-check: **PASS** — [run](https://github.com/contactmmx-ship-it/fkaios-aura-blueprint1/actions/runs/40656784123).
- Production migration drift check: **PASS** — [run](https://github.com/contactmmx-ship-it/fkaios-aura-blueprint1/actions/runs/40656784149). This is not a migration application or integration test.
- Standalone static preview build: **PASS** — [run and downloadable artifact](https://github.com/contactmmx-ship-it/fkaios-aura-blueprint1/actions/runs/40656776221). GitHub Pages deployment itself is unavailable because the GitHub integration cannot create/enable the Pages site; the workflow preserves a downloadable build artifact instead.
- Vercel deployment remains blocked by the daily free-plan deployment quota. The passing GitHub build is separate from deployment.
- No production migration, Edge Function deployment, activation, invite/email sending, or paid AI use occurred.

### Still required before release

- Non-production end-to-end persistence, token security, submit/email/private-report access tests.
- Accessibility and device/browser QA.
- Approved secure document upload implementation (the current checklist tracks availability only).
- Human review and completion of evidence-backed diagnosis and transformation plan; the current deterministic report must not be represented as a final diagnosis.
- Explicit approval before enabling any paid or metered AI model, and before production activation.


## Reusable template and server-validation update — 28 October 2026

These branch-only changes address several reusable-product gaps discovered during implementation. They are not production acceptance:

- [x] Added a shared generic template release gate for all brands. It validates question/section/checklist structure, supported answer-control schemas, unique IDs, count reconciliation, eight release-readiness checks, and a recorded human approval. Raahat still has its stricter source-specific gate.
- [x] Added unit tests for generic future-brand templates, missing approval, incomplete review, invalid counts/options, duplicate question IDs, inactive templates, invitation release-gate wiring, and no-send-by-default email policy.
- [x] Generalised the draft seeder so future brand JSON templates can be validated and seeded as draft without hard-coded Raahat counts. It refuses to overwrite non-draft versions and creates no invitation.
- [x] Added a separate explicit-confirmation activation script. It refuses activation unless the shared gate passes; Raahat also requires verified canonical source reconciliation. The script has not been run.
- [x] Invitation and completion emails are now disabled by default and require `FK_BRAND_DISCOVERY_EMAIL_SENDING_ENABLED=true` plus approved provider settings.
- [x] Removed the Raahat-only 20-item checklist constraint from respondent closure validation and made the user-facing missing-checklist message template-specific.
- [x] Server now validates answer shape and allowed choices before persistence, verifies the answer matches the supplied section/question position, and rejects oversized respondent request bodies.
- [x] Added a reusable template operating model covering versioning, provenance, review, release approval, seeding and activation.

### Release status remains blocked

- [ ] Confirm latest CI after the most recent implementation commits; the frontend check previously exposed a nullability issue that was fixed and is being rechecked.
- [ ] Run non-production migration and Edge Function deployment, then execute the complete invite → save → close/resume → edit → submit → private-report/access-control test matrix. No non-production environment is currently configured.
- [ ] Complete accessibility/device QA.
- [ ] Implement and test secure document upload if respondents are expected to submit actual files; the current checklist remains an availability declaration only.
- [ ] Complete evidence-backed human review workflow for the private report; the generated report is an evidence inventory and draft follow-up list, not a final diagnosis.
- [ ] Keep the PR draft/unmerged. No production migration, activation, invite/email sending, or paid AI use occurred.


## Raahat-specific conditional clarification correction — 28 October 2026

- [x] Added a separate optional text field when a Raahat single/multi-select answer chooses an option whose label begins with “Other”.
- [x] Added the same clarification field for Raahat multipart questions, separately keyed by question part.
- [x] Added the conditional clarification field for the “Other” service row in Raahat's service-status matrix.
- [x] Applied the same controls to both the Next.js preview and the standalone static preview.
- [x] Live respondent UI now recognises all “Other…” labels (not just the exact label “Other”) and clears a stale clarification when the respondent deselects the Other option.
- [x] Added regression assertions for the Raahat preview and respondent UI.
- [x] Latest CI on `93b04dbfa7a8cff1c691d02f52b05ea418ea11f1`: questionnaire source validation, frontend type-check/build/tests, Edge Function type-check and migration drift all PASS.

This is a Raahat-specific source-mapped questionnaire. The generic schema/release engine is only infrastructure; it does not mean future brands should reuse Raahat's questions. Raahat remains a draft/inactive pilot until the non-production end-to-end, security, accessibility, semantic and owner-approval gates are genuinely complete.


## Raahat respondent length correction — 28 October 2026

- [x] Created a separate Raahat-only guided-core draft with 71 source-traceable questions across all 16 sections.
- [x] Retained the full 235-question canonical source-mapped bank separately and unchanged for deeper follow-up.
- [x] Retained all 20 supporting-document checklist items.
- [x] Updated both Next.js and standalone static previews to display the 71-question guided core rather than presenting all 235 headings as the first respondent journey.
- [x] Added regression tests for 71-question count, 16-section coverage, exact prompt/source-block/choice preservation, original source numbering and unchanged 235-question full bank.
- [ ] Run the new guided-core CI checks and verify the current preview build.
- [ ] Conduct human review of why these 71 prompts are the right initial intake and which remaining questions should be triggered in follow-up sessions.
- [ ] Keep both Raahat templates inactive until semantic, privacy, security, accessibility, end-to-end and owner-release gates pass.
