# Raahat × Franchise Kart — Feature Acceptance Checklist

Status: requirements baseline; not a release approval.

## Canonical source requirements — hard gate
- [ ] Use the owner's supplied source document/message as the only canonical wording source.
- [ ] Preserve the canonical source's 16 numbered sections and all 235 numbered question headings in the original order; numbering is section-local. Do not impose a global numbering scheme or rename sections unless the canonical source itself does so.
- [ ] Preserve every question's exact wording, section introduction/instructions, options, subparts, ranges, and selection instruction.
- [ ] Preserve the original 20-item “Supporting Documents and Records” checklist, declaration, confidentiality text, owner/date/signature fields, FK sign-off, and next-step wording.
- [ ] Encode single-select, select-all, and select-up-to-N rules exactly as stated in the source.
- [ ] Preserve optional “Other” and explanation fields wherever present in the source.
- [ ] Automated validator must reject missing/duplicate section-local question numbers, missing/extra sections, altered selection limits, and a checklist count other than 20.
- [ ] Do not activate or serve the existing 234-question draft as if it were canonical.
- [ ] Record the actual reconciled question count only after transcribing and comparing the supplied source; do not infer a total from the replacement draft.

## Respondent experience
- [ ] Welcome/introduction and clear instructions.
- [x] One question at a time, with accessible radio/checkbox/text controls (code present; accessibility review pending).
- [ ] Correct answer types: single choice, multiple choice, select up to N, text, and explanation where specified.
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
- [ ] Enforce token validity, expiry, session status, questionnaire version, and server-side answer validation.
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
- [ ] A template cannot be marked active unless source reconciliation and automated validation pass.
- [ ] New-brand questions may be drafted with AI, but require human approval and must not overwrite an approved source.
- [ ] Document checklist and report sections can vary by approved brand/category template.

## Required validation evidence before release
- [ ] Exact source reconciliation report: 16 sections, 235 numbered question headings, 20 supporting-document checklist items, and exact question wording/order/options/selection rules verified against the canonical source.
- [x] Frontend type-check and production build pass (GitHub Actions run 40475218603).
- [x] Edge Function type-check passes (GitHub Actions run 40475218702).
- [ ] Automated questionnaire validation passes against the canonical bank (not the obsolete 234-question draft).
- [ ] Integration/security matrix passes in a non-production environment.
- [ ] End-to-end test covers invite → open → answer → save → close → resume → edit → submit → private FK review → owner completion email.
- [ ] Review confirms no owner access to internal FK analysis or execution plan.
- [x] PR remains draft/open and unmerged until all checks and required release approval are complete.

## Implementation status update — 27 October 2026

Code presence is not the same as release acceptance. Checked items above mean the described foundation exists in the branch; their annotations retain the required end-to-end verification caveat.

- Frontend validation PASS.
- Edge Function validation PASS.
- Questionnaire validation intentionally fails because the checked-in 234-question replacement bank is not the canonical source, even though the original source is now recovered and structurally extracted.
- Migration workflow is blocked before any migration is applied because required GitHub Actions Supabase secrets are absent.
- Vercel build-rate quota is exhausted; this is not a source-code compilation result.
- No non-production end-to-end journey or access-control test has been run.
- The canonical questionnaire has been recovered from the user's local file and pushed to the feature branch. The original text and loss-preserving structural extraction are now in the repository. It contains 16 numbered sections, 235 numbered question headings, 20 supporting-document checklist items, and confidentiality/acknowledgement and sign-off content. Runtime mapping and semantic review are still incomplete; do not activate the replacement draft.

## Current known blockers at time this checklist was added
- The repository's existing 234-question file is explicitly a non-canonical draft and must not be activated.
- Production migration and Edge Functions have not been deployed.
- GitHub Actions migration workflow is blocked by missing repository secrets; never paste secrets into chat.
- Vercel deployment quota has been exhausted; a deployment failure from quota exhaustion is not evidence of a source-code failure.
- Email delivery, private analysis/plan generation, private report UI, and full end-to-end security journey remain unverified or unfinished.
