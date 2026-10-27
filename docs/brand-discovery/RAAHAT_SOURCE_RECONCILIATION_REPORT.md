# Raahat Source Reconciliation Report

Status: automated source-to-runtime mapping implemented and validated in the feature branch; semantic sign-off, end-to-end testing, security review, and release approval remain outstanding.

## Canonical source evidence

- Repository file: `docs/brand-discovery/source/RAAHAT_OWNER_DISCOVERY_QUESTIONNAIRE_ORIGINAL.txt`
- Source blob SHA: `4c8588b88885a049766ea47d22699c1889f7b478`
- Structural transcription: `docs/brand-discovery/source/RAAHAT_SOURCE_TRANSCRIPTION_V1.json`
- Source sections: 16
- Numbered question headings: 235
- Supporting-document checklist rows: 20
- The source contains section/question instructions, checkbox options, subparts, document checklist, confidentiality text, owner/date/signature fields, Franchise Kart sign-off, and next-step wording.

## Current runtime mapping

The configuration remains `status: "draft"` and `source_status: "CANONICAL_SOURCE_MAPPED_DRAFT"`. The template must not be activated until semantic review and release gates pass.

- 223 simple choice questions preserve source prompt, option wording/order, and mapped selection mode/limit.
- 10 multi-part questions have separate controls for each independent part, including the six questions explicitly split into A/B/C source subparts.
- One service inventory question records each selected service and its operational status separately.
- One hall-capacity question supports repeatable named halls/event spaces with one capacity range per row.
- Room inventory, meal-period bill ranges, room-category rate ranges, and monthly occupancy prompts use separate controls rather than a flattened list.
- The 20-item document checklist is mapped in source order with the three source status labels.
- The original confidentiality/acknowledgement and next-step text is preserved in the runtime configuration. The respondent flow shows the declaration, date, typed-name acknowledgement, and an internal-only Franchise Kart sign-off note.
- Server-side validation checks choice values, duplicate choices, single/multiple selection rules, maximum selections, per-service statuses, repeatable capacity rows, checklist statuses, acknowledgement date/name, and explicit acknowledgement before submission.
- The checklist and acknowledgement draft can autosave and resume. Final submission requires all 20 document statuses and acknowledgement fields.

## Validation boundaries and review items

Automated validation compares the 235 prompt/source blocks, section-local numbering/order, source options and selection rules, complex control mappings, checklist order, and declaration text. Passing this check establishes source mapping consistency, not business correctness or release readiness.

The following inferred mappings require a human semantic review before activation:
- Room categories used to capture room-rate ranges.
- Twelve month-by-month occupancy selections, because the prompt asks for each month while its short source instruction says “Select one.”
- Questions where a source prompt asks for a detailed numeric/business fact but its available choices primarily describe record availability or categories.
- The user-facing layout and wording of the source-derived custom controls.

## Release blockers

- Review the latest frontend, Edge Function, and questionnaire validation workflows after all changes settle.
- Test invitation → open → answer → autosave → close → exact resume → back/edit → document checklist → acknowledgement → submit → private FK review in a non-production environment.
- Test invalid/expired tokens, altered choice values, duplicate/over-limit selections, incomplete multipart answers, service status gaps, invalid capacity rows, incomplete checklist, and respondent access to private reports.
- Review accessibility, keyboard operation, small screens, and browser-native voice behavior.
- Confirm approved email sender/provider and privacy wording before enabling email delivery.
- Configure required Supabase secrets through the approved secret manager; do not paste them into chat.
- Apply the new migration only to an authorized non-production project after secret configuration and approval. The migration workflow previously stopped before migration because required secrets were absent.
- Keep the template inactive, PR draft/open, and production undeployed until release approval.

No production migration, deployment, email delivery, paid AI call, or questionnaire activation is authorized or claimed by this report.
