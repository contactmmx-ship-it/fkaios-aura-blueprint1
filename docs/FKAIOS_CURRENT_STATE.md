# FKAIOS current state — 9 Oct 2026, ~04:00 UTC

This page is the short answer to "what really works today". Detail is in the [acceptance matrix](FKAIOS_ACCEPTANCE_MATRIX.md), and the running log is the [execution checkpoint](FKAIOS_EXECUTION_CHECKPOINT.md).

## Verified in production (with evidence)

**Resource routing:**
- Model failover, continuation, schema-enforced structured output, and a transient retry, all proven by self-tests.
- Production runs on free Gemini: gemini-3.5-flash-lite is adopted; 3.5-flash and 3.7-flash are verified.

**Governed model evaluation:** a golden suite, deferral cancel, and adoption by founder approval (de2aeafd pending).

**Speech and voice:**
- 7 Gemini STT and TTS resources were verified autonomously by round-trip word error rate.
- A voice turn (speech → answer → speech) passed end to end twice.

**Knowledge library:**
- Exact-page retrieval works: printed page vs PDF page, PDF labels, footer numbers, an inferred label, edition clarification, and SHA-256 dedup.
- OCR of a scanned page works.
- The two supplied histories are ingested and searchable, with line references.

**Daily ecosystem discovery:**
- The first real scheduled run was 9 Oct 08:21 IST: 6 sources, 180 candidates, deduplicated, metadata only.

**Executive engine:** opportunity-engine ran on schedule (03:30 UTC) through resource routing and produced 4 proposals.

**Stale-work reaper:** runs hourly; there are no more indefinite `generating` or `working` states.

**Project inventory, connector registry and agent catalog:** generated from live tables.

## Implemented, awaiting proof

- **workday-engine and staff-engine routing repairs:** deploying now. The next scheduled phase, or a manual run, proves them.
- **evolution-engine and executive-brain:** scheduled for 04:00 and 04:30 UTC.

## Not proven / blocked

| Item | Why | Who |
|---|---|---|
| A real founder objective end to end (test 1) | None has been submitted from the Console; creating one through SQL is forbidden | Rajeev |
| Blueprint reuse (Mr. Chick'n SOPs → new brand; Healthfreek → Chaat Masters) | The source documents are not in any accessible system | Rajeev uploads them |
| Cron secret in URLs (RED) | Rotation needs the founder; the automated Vault write was refused | Rajeev, then Claude |
| Independent verification | Only one working provider (Gemini). Same-model verification is recorded as `producers_unknown`, never "independent" | Founder: a second provider is optional and paid |
| Local inference | No `SELF_HOSTED_SPEECH_BASE_URL` / local host | Founder (optional) |
| Communications send | Never sent; needs a founder approval | Rajeev |
| Maps geocoding | Nominatim blocks edge egress | Founder decision (paid geocoder) |
| Paid lead discovery | Stopped by an auth failure, left stopped (it spends Apify credits) | Founder decision |
