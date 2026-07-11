# FKAIOS Autonomous Commercial Pipeline (production cron chain)

The enterprise runs itself through a closed loop of pg_cron jobs. Each stage
feeds the next; no human trigger required.

| # | Stage | Function | Cron job | Schedule |
|---|-------|----------|----------|----------|
| 1 | DISCOVER | auto-agents-engine `hunt-leads` → lead-discovery/research-engine | 25, 26 | daily 04:00 / 04:15 |
| 2 | ENRICH  | enrichment `enrich_new` (reuses maps-engine / OpenStreetMap) | 31 | :05, :35 hourly |
| 3 | QUALIFY | auto-agents-engine `qualify` (Claude BANT; advances score≥40 → contacted) | 21, 22 | every 30 min |
| 4 | NURTURE / ADVANCE | auto-pilot (contacted → qualified → proposal) | 15 | every 5 min |
| 5 | METRICS | reconcile_agent_metrics() (dispatch log → agent rollups) | 30 | every 15 min |

## Verified repairs (this line of work)
- Metrics disconnect fixed: rollups derive from real agent_dispatch_log (job 30).
- Qualifier root cause fixed: was selecting a non-existent `name` column →
  "none found" on all runs; now scores real leads and advances qualified ones.
- Enrichment repaired + connected: reads via maps-engine, writes contacts back
  onto the leads row; wired into the loop (job 31).

## Honest current blocker (not a code bug)
Lead discovery yields uncontactable scraped names; free OpenStreetMap has no
record for most of them (0/8 enriched in the verification run). Real phone
capture requires the PAID Apify Google-Maps path — a spend decision reserved
for the founder. Until then the loop runs truthfully but produces few
qualified, contactable leads. Revenue in production: ₹0 (no invoices/payments).
