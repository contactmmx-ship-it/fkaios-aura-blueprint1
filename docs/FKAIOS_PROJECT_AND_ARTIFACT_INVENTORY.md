# FKAIOS project and artifact inventory

Generated on 9 Oct 2026 at 02:55 UTC from live production tables (Supabase `nrlsqshkjuuwiovthrnb`), Storage buckets, this repository and the two supplied histories.

**Spreadsheet:** [`fkaios_project_inventory.csv`](fkaios_project_inventory.csv), one row per project, with columns for kind, owner, location, status, limitations, next action and evidence source.

Only systems FKAIOS can actually read are listed as sources. A project named only in a conversation is marked **NOT IN ACCESSIBLE SYSTEMS**. It is never presented as connected.

## Portfolio

### Companies

There are 4 companies (`companies`): Aura Tech, Bhavishya Associates, Franchise Kart and Rajyog Infra.

### Brands

There are 8 brands (`brands`), all owned by Franchise Kart:

| Brand | Sector | Investment / royalty | Linked records |
|---|---|---|---|
| Mr. Chick'n | F&B QSR | not set | 5 leads; 2 AI-drafted partner proposals |
| Chaat Masters | QSR | 10L–30L / 8% | none |
| Arofur | Furniture | 20L–1Cr / 6% | 5 archived research notes |
| Chawla Laboratory | Healthcare | 15L–40L / 10% | none |
| Franchisee Kart | Consulting | 5L–50L / 5–15% | 1 website build |
| Gio Paints | Paints | not set | none |
| GoMax | Building materials | not set | none (no data connector) |
| Turning Points | Immigration | 50K–2L / 10% | none |

### Work outputs

| Table | Rows | State |
|---|---|---|
| `client_projects` | 269 | All `proposal` status, AI-drafted from discovered leads; none MD-approved |
| `orchestration_projects` | 253 | 17 complete, 212 failed, 23 working, 1 merging. The 24 non-terminal rows need a stale-state check |
| `build_projects` | 25 | 11 complete and deployed (5–6 Oct). 9 have been stuck in `generating` (3 since July) |
| `brain_projects` | 2 | Dental Kart 3D video brief: v1 approved, v2 awaiting founder review with sections 3–10 unwritten |
| `software_projects` | 1 | Dealer CRM: planned only, with unknowns recorded |

### Stored artifacts

- **`project-submissions` bucket (5 files):** `bharat-paints-website.zip`, `UPDATED FINAL FK REAL PATH 2030(1).docx`, `bharatbuild_android_scaffold.zip`, `bharatbuild_founder_demo.html` and `index.html`.
- **`product-video-photos` bucket:** 1 image.
- **`documents` bucket:** empty.

### Knowledge

- The new page-level library (`fkaios_knowledge_sources`/`pages`) holds the two supplied histories once the `history_ingest` self-test has run.
- The older `brain_knowledge_documents` table has 11 rows: 10 archived placeholders plus the FKAIOS charter.

## Named in history but not in any accessible system

| Name | Where it is mentioned | What is needed |
|---|---|---|
| Syros OPD EMR | `input/fkaios-history/fkaios_chat_2.txt` lines 2268–2879 | A repository or project link |
| PerfumeWala | The same file (used as examples) | A brand or project record if it is active |
| Healthfreek proposal | The mission brief (blueprint source) | Upload the proposal to the `documents` bucket |
| Mr. Chick'n SOPs | The mission brief | Upload the SOP files to the `documents` bucket |

## Defects found while building the inventory

1. **`hunt_leads` is failing.** It failed 14 times in 7 days with `UNAUTHORIZED_NO_AUTH_HEADER`: the auto-agents path calls research-engine with no auth header.
2. **Rows sit indefinitely in non-terminal states.** This affects 9 `build_projects` rows in `generating` and 24 `orchestration_projects` rows in `working` or `merging`. No timeout reason is visible.
3. **The `connectors` table is a static seed from 8 Jul with no health checks.** It shows OpenAI and Anthropic as "connected", but both providers are failing with `credit_exhaustion`. See [the connector registry](FKAIOS_CONNECTOR_REGISTRY.md).
