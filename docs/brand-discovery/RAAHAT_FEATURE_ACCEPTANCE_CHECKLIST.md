# Raahat × Franchise Kart — Feature Acceptance Checklist

Status: requirements baseline; not a release approval.

## Canonical source requirements — hard gate
- [ ] Use the owner's supplied source document/message as the only canonical wording source.
- [ ] Exactly 95 questions, numbered Q1–Q95, in 17 parts A–Q, in the original order.
- [ ] Preserve every question's exact wording, options, and selection instruction.
- [ ] Preserve the original 16-item document checklist, declaration, signature/date fields, FK sign-off, and confidentiality text.
- [ ] Encode single-select, select-all, and select-up-to-N rules exactly as stated in the source.
- [ ] Preserve optional “Other” and explanation fields wherever present in the source.
- [ ] Automated validator must reject missing/duplicate question numbers, missing/extra sections, altered selection limits, and checklist count other than 16.
- [ ] Do not activate or serve the existing 234-question draft as if it were canonical.

## Respondent experience
- [ ] Welcome/introduction and clear instructions.
- [ ] One question at a time, with accessible radio/checkbox/text controls.
- [ ] Correct answer types: single choice, multiple choice, select up to N, text, and explanation where specified.
- [ ] Back/forward navigation and ability to edit previous answers.
- [ ] Visible section and overall progress; clear section and final completion states.
- [ ] Persistent autosave/manual-save behaviour with save/error feedback.
- [ ] Secure resume link; resume at the exact saved question and restore prior answers.
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
- [ ] Authenticated staff invitation with explicit email allowlist.
- [ ] Private view of submitted answers and document checklist status.
- [ ] Separate documented statuses for received, missing, unclear, and needing verification.
- [ ] Analysis distinguishes owner statements, verified evidence, and AI-generated hypotheses.
- [ ] Diagnosis covers only what the answers/evidence support; no invented financials or unsupported promises.
- [ ] Transformation plan includes priorities, measurable targets, actions, timeline, accountable owner, dependencies, and verification method.
- [ ] Private reports are available only to authorised FK staff; respondent APIs never return them.
- [ ] Reusable questionnaire/template architecture for future brands; Raahat is the first template, not a hard-coded one-off.

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
- [ ] Questionnaire content is versioned/configuration-driven, not embedded in respondent UI.
- [ ] A template cannot be marked active unless source reconciliation and automated validation pass.
- [ ] New-brand questions may be drafted with AI, but require human approval and must not overwrite an approved source.
- [ ] Document checklist and report sections can vary by approved brand/category template.

## Required validation evidence before release
- [ ] Exact source reconciliation report: 95 questions, 17 parts A–Q, 16 checklist items, exact numbering/order/options/selection rules.
- [ ] Frontend type-check and production build pass.
- [ ] Edge Function type-check passes.
- [ ] Automated questionnaire validation passes against the canonical bank (not the obsolete 234-question draft).
- [ ] Integration/security matrix passes in a non-production environment.
- [ ] End-to-end test covers invite → open → answer → save → close → resume → edit → submit → private FK review → owner completion email.
- [ ] Review confirms no owner access to internal FK analysis or execution plan.
- [ ] PR remains unmerged until all checks and required release approval are complete.

## Current known blockers at time this checklist was added
- The repository's existing 234-question file is explicitly a non-canonical draft and must not be activated.
- Production migration and Edge Functions have not been deployed.
- GitHub Actions migration workflow is blocked by missing repository secrets; never paste secrets into chat.
- Vercel deployment quota has been exhausted; a deployment failure from quota exhaustion is not evidence of a source-code failure.
- Email delivery, private analysis/plan generation, private report UI, and full end-to-end security journey remain unverified or unfinished.
