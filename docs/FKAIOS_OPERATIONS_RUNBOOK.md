# FKAIOS operations runbook and operator's guide

## For Rajeev: how to work with FKAIOS

### Give an objective

Open the Console's **Objective Command** and type the outcome you want, or record it with voice. It is sent to `founder-objective`, which needs your sign-in.

The Founder Brain tick runs every minute. It plans the objective, assigns resources and executes it. You can watch progress in the Console (`status` / `refresh`).

### Ask for a page of a book

1. Upload the PDF to the private Supabase Storage bucket `documents`.
2. Ask FKAIOS to ingest it (`knowledge_ingest` with `storagePath`, `title`, and optionally `author`, `edition` and `copyrightClass`).
3. Ask "page 18 of <title>" (`knowledge_page`).

The answer states:
- whether 18 is the **printed** page or the PDF page;
- how the page number was established;
- whether the text came from the text layer or from OCR;
- whether the result is complete, partial, OCR-derived or uncertain.

If two books or editions match, FKAIOS asks which one you mean.

### Search past work

Use `knowledge_search` with a question. It searches the two supplied ChatGPT histories (already ingested) and every document you have ingested. Each result gives the source and the page or line range.

### Approvals

FKAIOS asks you before:
- adopting a new model when its cost is unknown;
- any external message;
- any spend.

Pending today: **de2aeafd**, adopting gemini-3.7-flash for coding (it scored 1.0 against 0.0 on the golden suite). It expires on 12 Oct.

### Daily discovery

Every day after 06:00 IST, FKAIOS scans:
- the official MCP registry;
- GitHub (MCP servers, agent frameworks, PDF/OCR tools);
- Hugging Face trending models;
- OpenRouter's free models.

Results are ranked by fit to FKAIOS needs, in `fkaios_ecosystem_candidates`. Nothing found is installed without testing and approval.

## For operators

| Check | Query or place |
|---|---|
| Engine self-test | `insert into fkaios_self_tests (requested_by, status, scenarios) values ('<you>', 'requested', array['knowledge_pages'])`. The next ticks run it; results are in `fkaios_self_tests.results`. Omit `scenarios` to run all 11 |
| Discovery runs | `select * from fkaios_discovery_runs order by started_at desc` |
| Evidence ledger | `fkaios_verification_evidence` (`requirement_key` prefixes: `eval:`, `self_test:`, `communication:`, `discovery:`, `knowledge:`) |
| Provider health | `provider_health_state`, `model_registry.lifecycle_state` |
| Cron outcomes | `cron.job_run_details` joined with `net._http_response` (status codes and bodies) |
| Stale work | `select public.fkaios_reap_stale_work()` (it also runs hourly) |

### Deploys

- Edge functions deploy **only through CI** (`.github/workflows/deploy-supabase-functions.yml`) on a push to `main`.
- Database changes go through `apply_migration`. The repo copy is named `<live version>_<name>.sql` and must be byte-identical (check its md5 against `supabase_migrations.schema_migrations.statements`).

### Reproducible verification

1. Run the `_shared` tests: `deno test -A --no-check _shared/` (151 pass; A7 fails as it did before this work).
2. Request a self-test with all scenarios and confirm `status = 'passed'`.
3. Confirm today's `fkaios_discovery_runs` row with `trigger = 'scheduled'`.
4. Compare each `supabase/migrations/2026100902*`/`03*` file's md5 with the live statements.
