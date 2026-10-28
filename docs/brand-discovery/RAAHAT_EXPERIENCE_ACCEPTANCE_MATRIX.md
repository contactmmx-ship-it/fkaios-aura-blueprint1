# Raahat Brand Discovery — Experience Acceptance Matrix

**Owner:** Franchise Kart / FKAIOS  
**Target:** Raahat owner discovery preview  
**Status:** In-progress, preview only. Do not activate for respondents or connect production until explicit approval and release gates pass.

## What is implemented in the browser preview

- Premium forest-green, warm-ivory and muted-gold design language.
- Dedicated welcome / expectation-setting screen.
- Canonical mapped question bank: 16 sections, 235 question headings, source-defined options and complex answer controls.
- One-question-at-a-time journey, section navigator, progress indicators, previous/next navigation.
- Question explanations and section-level “why we ask” context.
- Optional browser speech playback and browser-native speech-to-text dictation where supported.
- Local browser autosave and resume, including journey stage; welcome-back message when saved responses are found.
- Required-question gate and required acknowledgement gate.
- Supporting-document status checklist with explicit self-reported vs received/reviewed/verified distinction.
- Review all questions and jump back to edit an answer.
- Local JSON export and browser print / save-as-PDF action.
- Preview-only and no-submission disclosures.

## Still missing or not production-functional

| Capability | Current state | What completion means |
|---|---|---|
| Real conversational AI guide | Not connected | Authenticated server-side model/tool integration, context-aware answers, safety boundaries, Hindi/Hinglish/English handling, no false claims, and approved model/cost policy |
| Natural conversational voice guide | Not connected | Speech input + spoken responses tied to the AI guide, interruption/retry handling, accessible text fallback |
| Secure document upload | Not connected | Private storage, file type/size validation, access control, malware scanning or safe file handling, upload/receipt status audit |
| Server-side save/resume | Not connected | Authenticated/token-scoped persistence, autosave conflict handling, cross-device resume, expiry and recovery |
| Respondent invitation/token | Not functional in live environment | Secure token issue/expiry/revocation and respondent page backed by a deployed function |
| Final submission | Preview-only | Server-side validation, idempotent submission, audit event, confirmation state and safe failure/retry handling |
| Completion email | Not connected | Approved email provider, template, delivery status, retry/idempotency and no sending until authorized |
| Private FK diagnostic report | Not generated | Separate internal-only analysis pipeline, evidence-state labels, gap/risk summary and execution plan; never rendered to respondent |
| Owner/brand template reuse | Draft mapping only | Versioned category templates, schema validation, migration/version policy and regression coverage |
| Accessibility and device QA | Not yet verified end-to-end | Keyboard-only journey, focus handling, screen-reader labels, zoom/reflow, reduced motion, mobile/desktop checks |
| Full end-to-end QA | Not yet passed on current head | Build, all questionnaire-specific validations, save/resume/edit/export tests, accessibility checks and non-production respondent journey |
| Deployment | Not verified on current head | Successful preview build and tested URL for the exact current commit |

## Non-negotiable data semantics

1. An owner response is **self-reported** unless independently verified.
2. “Available” does not mean received, reviewed or verified.
3. Missing numbers or operational facts must be flagged for follow-up, not inferred.
4. “Other” clarifications remain separate from canonical option values and are optional unless explicitly approved otherwise.
5. Preserve source option labels, ordering and selection rules unless a versioned, explicitly approved change is made.
6. The internal FK report is never shown to the respondent.
7. No production migration, activation, respondent invitation, email or paid API usage without explicit approval.

## Release gate

Keep inactive until all required capabilities have an agreed scope, the implementation is connected and secured, current-head CI passes, the non-production end-to-end journey passes, and Rajeev explicitly approves activation.
