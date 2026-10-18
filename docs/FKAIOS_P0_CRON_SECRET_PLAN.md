# P0: heartbeat secret exposed in logs — rotation and header plan

**Status: RED until rotated.** Prepared 8 Oct 2026. The secret value never appears in this document, in any migration, or in any output.

## What is wrong

- Most `pg_cron` jobs call edge functions with the heartbeat secret in the URL (`…/heartbeat-engine?secret=…`).
- Supabase's edge request log records full request URLs, so the secret has been readable by anyone with log access.
- `agent-scheduler` also writes `req.url` into its own function log.
- The secret must therefore be treated as **compromised**. Moving it to a header is not enough without rotation.

## Why it is not already fixed

The first fix would have copied the existing secret from a cron command into Supabase Vault. The session's safety control stopped that, because it was an automated write of a credential into a secret store. That is correct: a secret-store write is a founder-level security action. The plan below needs no automated secret handling at all.

## Plan

### Step 1 — Rajeev (about 5 minutes, Supabase dashboard)

1. Generate a new random secret (at least 32 characters). For example, run `openssl rand -base64 36 | tr -dc A-Za-z0-9 | head -c 40` in any terminal.
2. **Edge Functions → Secrets:** set `HEARTBEAT_SECRET` to the new value. Every function picks it up on its next cold start.
3. **SQL editor:** store the same new value in Vault under the name `fkaios_cron_secret`:
   ```sql
   select vault.create_secret('<NEW VALUE>', 'fkaios_cron_secret', 'HEARTBEAT_SECRET for pg_cron (x-heartbeat-secret header)');
   ```
4. Tell Claude "cron secret rotated".

Between steps 2 and 5, cron calls that still carry the old secret in the URL return 401. This is safe (nothing runs), and step 5 closes the gap within minutes.

### Step 2 — Claude (automatic, once Rajeev confirms)

Apply the migration below. It contains no secret, reads Vault only at call time, and changes only cron job commands:

```sql
create or replace function public.fkaios_cron_call(p_path text, p_method text default 'POST', p_body jsonb default '{}'::jsonb, p_timeout_ms integer default 5000)
returns bigint language plpgsql security definer set search_path = '' as $f$
declare v_secret text; v_url text := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/' || p_path; v_headers jsonb;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'fkaios_cron_secret';
  if v_secret is null then raise exception 'vault secret fkaios_cron_secret is missing'; end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-heartbeat-secret', v_secret);
  if p_method = 'GET' then return net.http_get(url := v_url, headers := v_headers, timeout_milliseconds := p_timeout_ms); end if;
  return net.http_post(url := v_url, headers := v_headers, body := p_body, timeout_milliseconds := p_timeout_ms);
end $f$;
revoke all on function public.fkaios_cron_call(text, text, jsonb, integer) from public, anon, authenticated;
-- then, per job: select cron.alter_job(job_id := (select jobid from cron.job where jobname = '<job>'), command := $c$select public.fkaios_cron_call('<path>', '<method>', '<body>', <timeout>)$c$);
```

| Job | Call |
|---|---|
| aeos-heartbeat | `heartbeat-engine`, GET |
| agent-scheduler-5min | `agent-scheduler/tick` |
| auto-agents-daily-report / -hunt-leads-at / -hunt-leads-fk / -qualify | `auto-agents-engine` with the existing bodies, 60 s |
| auto-pilot-5min | `auto-pilot`, GET |
| ceo-think-daily | `opportunity-engine`, 150 s |
| enrich-new-leads | `enrichment` `{"action":"enrich_new","limit":10}`, 90 s |
| enterprise-evolution-daily | `evolution-engine`, 150 s |
| executive-brain-daily | `executive-brain`, 150 s |
| job-scheduler-drain | `job-scheduler` `{"action":"process_pending"}`, 60 s |
| proposal-engine-hourly / sales-draft-proposals-hourly | `proposal-engine` |
| workday-morning / -midday / -evening / -ceo | `workday-engine` with `{"phase": …}`, 120 s |

**Header support in deployed code:**
- Confirmed by reading the deployed source: heartbeat-engine v29, agent-scheduler v48, workday-engine v22.
- Confirmed in repo code, deployed by CI: opportunity-engine, evolution-engine and executive-brain (PR #59).
- Confirmed from the first run after the switch, rolled back individually on a 401: auto-pilot, job-scheduler, enrichment, proposal-engine, auto-agents-engine.

### Step 3 — the one exception: executive-intelligence

The deployed `executive-intelligence` v19 was previously observed reading the secret only from the query string. PR #168 added `executive-intelligence` to the CI deployment workflow and added header/legacy-query validation in repository source; the workflow subsequently deployed v23. This closes the former CI-path omission, but it does not by itself prove deployed-source parity or successful scheduled authentication. Verify the deployed handler behavior and daily job's HTTP result after the coordinated secret rotation before treating this job as recovered. Until then, the shared-secret incident remains open.

### Step 4 — verification (Claude)

- **Edge logs:** no request URL contains `secret=` after the switch.
- **Every rewritten job:** its next run returns 200.
- **The old secret:** a probe with it returns 401.


## Verified follow-up — 2026-10-17

This section supersedes any assumption that the existing inventory and source review are complete.

- The latest read-only inventory found 19 active Edge Function cron jobs: 16 with query-string credentials, 2 using the header, and 1 using neither pattern. Review the last job separately; do not include it in a generic rewrite.
- The shared cron credential must be treated as exposed because request URLs were logged. Do not copy credentials into source, comments, runbooks, or diagnostic output.
- Recent edge request logs showed repeated 401 responses for auto-pilot and agent-scheduler/tick, plus an executive-intelligence 401. This does not establish that every scheduled job is failing.
- The proposal-engine handler now prefers the x-heartbeat-secret header and keeps query-string support only for compatibility.
- auto-agents-engine internal calls to staff-engine and lead-discovery now send the credential only in the header; both downstream handlers support that header in repository source.
- These repository changes are not production fixes until the reviewed deployment workflow succeeds and deployed function versions are verified.
- The GitHub migration-drift workflow failed at `List production migrations` because `SUPABASE_ACCESS_TOKEN` lacks `database_migrations_read`; its repository comparison was skipped, so the workflow provides no parity result. A separate read-only Supabase migration listing returned production history through `20261013143919` (`normalize_ten_brand_registry_recovery`) on 18 October 2026. This does not prove repository parity; fix the token's read permission or provide an approved read-only migration source, then rerun the comparison.
- Do not rotate the shared credential or alter production cron commands until the deployment/auth contracts and a per-job rollback/verification sequence are ready. No production secrets or cron schedules were changed by this audit.
