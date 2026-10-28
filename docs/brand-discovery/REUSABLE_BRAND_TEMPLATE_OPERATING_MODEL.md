# Reusable FK Brand Discovery Template — Operating Model

**Status:** implementation contract for the draft branch; not a declaration that production is ready.

## Design principle

Raahat is the first source-reconciled pilot, not the schema for every future brand. Each brand receives an immutable, versioned questionnaire definition. Shared respondent, answer, checklist, evidence-report, privacy, and approval rules are reusable; brand-specific wording, question counts, categories, and evidence checklist contents remain in that version's JSON definition.

## Template lifecycle

1. **Create a draft** from the canonical FK core and the selected business-category modules. Never edit an active version in place.
2. **Record provenance per question.** Preserve source prompt, source block/reference, source status, option labels/order, selection mode, and any multipart mapping. Do not invent facts or silently rewrite source choices.
3. **Validate structure**: unique section/question/part/option/checklist IDs; supported question types; valid selection rules; declared question count equals the actual number of questions; all answer controls match the saved answer shape. Every question must carry provenance via `source_block` or `source_reference`; an active template accepts only `CANONICAL_SOURCE_VERIFIED`, `FK_AUTHORED_AND_APPROVED`, or `BRAND_OWNER_APPROVED` question provenance.
4. **Review semantics**: distinguish self-reported facts from records available; never infer a number, occupancy percentage, evidence receipt, review, or verification state. Keep any Other clarification separate from the canonical answer.
5. **Test the journey** in non-production: invite, open, save, close, resume, back/edit, checklist, acknowledgement, submit, completion status and private report. Test invalid/expired tokens and malformed answers.
6. **Complete all release checks** in `release_readiness`: `source_mapping_reviewed`, `question_semantics_reviewed`, `answer_controls_tested`, `privacy_review_complete`, `accessibility_review_complete`, `security_review_complete`, `end_to_end_test_complete`, and `owner_release_approved`.
7. **Record a human release approval** in `release_approval` with `approved_by`, `approval_reference`, and ISO timestamp `approved_at`. The invite endpoint independently checks this metadata and the checklist/question structure.
8. **Validate twice for Raahat**: first run the canonical source validator while the bank is `draft` / `CANONICAL_SOURCE_MAPPED_DRAFT` and all interactive review flags remain false; after the real non-production QA is complete, promote the reviewed candidate's statuses/flags to their verified values and rerun the same validator. It checks the same exact source prompts, source blocks, option order, control mapping, checklist and acknowledgement in either state. Never set review flags true just to pass a validator.
9. **Retain old versions** for sessions already invited. Create a new version for wording, options, module, checklist, or logic changes and preserve historical answer interpretation.

## Supported question controls

- `text`, `long_text`, `file_or_text`, `repeatable_list`
- `multiple_choice` with single/multiple selection and optional maximum
- `multi_part` with independently validated parts
- `service_status` with separately selected services and a status for each
- `repeatable_choice` for named rows with a choice per row

The release gate checks question IDs, prompt, required flag, type-specific option structure, uniqueness, count reconciliation, checklist structure, review flags, and human approval. The Raahat-specific validator remains stricter and verifies source wording and source order.

## Draft seeding (no invitations)

1. Copy a template JSON into `config/brand-discovery/` and give it a unique filename.
2. Set a unique lowercase kebab-case `slug`, positive `version`, `brand.name`, `brand.category`, a real question count, sections, checklist and acknowledgement. Keep `status: "draft"`.
3. Preserve the original source or record FK-authored provenance; do not invent owner facts or label unreviewed questions as verified.
4. Run `node scripts/validate-brand-discovery-template.mjs future-brand-v1.draft.json` to validate a future brand draft offline without database credentials. For Raahat, also run `node scripts/validate-brand-discovery-questionnaire.mjs` to verify exact source reconciliation.
5. Seed only to an authorised non-production environment after explicit approval, with `BRAND_DISCOVERY_SEED_CONFIRM=I_UNDERSTAND_DRAFT_SEED` and the selected JSON filename, for example: `node scripts/seed-brand-discovery-questionnaire.mjs future-brand-v1.draft.json`.

The seeder only inserts or updates a row that is still `draft`; it refuses to overwrite a non-draft version and never creates a session or invitation. Do not put credentials in a command shared in chat or commit them to the repository.

Activation is a separate operation and is not part of seeding. Only after all checks have genuinely passed in an authorised non-production environment, run `node scripts/activate-brand-discovery-template.mjs <slug> <version> --confirm-activate` with `BRAND_DISCOVERY_ACTIVATE_CONFIRM=I_APPROVE_TEMPLATE_RELEASE` set through the approved secret manager. If an earlier version is active, the operator must also explicitly pass `--retire-existing-active`. The script refuses activation if review flags, recorded human approval, schema checks, or (for Raahat) canonical source verification are incomplete. It does not create invitations or send email. Do not run this command against production without separate explicit release approval.

## Security and delivery defaults

- Respondent tokens are random, high entropy and stored as hashes.
- Respondent API responses never contain the FK private report.
- FK endpoints require a valid Supabase JWT and a server-side email allowlist.
- CORS is exact-origin only; no wildcard production origin.
- Invitation and completion emails are **disabled by default**. Sending requires `FK_BRAND_DISCOVERY_EMAIL_SENDING_ENABLED=true` plus the approved provider configuration. This switch is not set by this change.
- Model/AI use remains separately opt-in and is not required for the questionnaire, validation, or evidence report.
- The checklist records respondent-reported availability; it is not a secure upload system and does not prove receipt, review, or verification.
- The report remains an evidence inventory and draft follow-up list, not a verified business diagnosis or approved execution plan.

## Current release truth

The reusable release gate and automated tests are in this draft PR. They do not substitute for the still-required non-production database migration, deployed Edge Functions, invite-to-report end-to-end tests, staff access matrix, accessibility/device QA, secure document-upload implementation if uploads are required, and explicit release approval. Do not activate, email respondents, or apply production migrations on the strength of a green unit test alone.
