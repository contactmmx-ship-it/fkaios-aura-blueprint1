# Raahat × Franchise Kart — Feature Acceptance Checklist

Status: requirements baseline; not a release approval.

## Canonical source requirements — hard gate
- [x] Use the owner's supplied source document/message as the only canonical wording source; the recovered source is preserved in the repository.
- [x] Preserve the canonical source's 16 numbered sections and all 235 numbered question headings in the original order; numbering is section-local.
- [x] Automated validator compares all 235 exact question prompts/source blocks, source options/order, section-local numbering, and selection instructions; human semantic review remains required.
- [x] Preserve the original 20-item checklist and declaration/confidentiality/sign-off/next-step wording in runtime configuration; checklist and acknowledgement UI is implemented (end-to-end persistence still needs testing).
- [x] Encode source selection modes and limits in the runtime mapping; interactive end-to-end testing remains pending.
- [ ] Preserve optional “Other” and explanation fields wherever present in the source.
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
