# FKAIOS connector and resource registry

Sources: `provider_health_state`, `model_registry`, `fkaios_resource_capabilities`, `connectors` and `cron.job`, read 9 Oct 2026 at 02:55 UTC. Credentials are recorded by environment-variable **name** only.

## Live status

| Connector | Credential (name only) | Operations | Status | Evidence | Next action |
|---|---|---|---|---|---|
| **Google Gemini** (LLM, STT, TTS, OCR) | `GEMINI_API_KEY` | Text generation, structured output, STT, TTS, PDF OCR | **VERIFIED, available** (last success 9 Oct 02:52) | gemini-3.5-flash-lite is adopted; 3.5-flash and 3.7-flash are verified; 5 STT and TTS resources verified by WER; voice turn passed | Founder decision on approval de2aeafd (adopt 3.7-flash for coding) |
| **Anthropic** | `ANTHROPIC_API_KEY` | LLM | **BLOCKED (credit)**: "credit balance is too low"; 1121 consecutive failures; last success 22 Sep | `provider_health_state` | Founder: add credit only if wanted. Routing already skips it |
| **OpenAI** | `OPENAI_API_KEY` | LLM, STT, TTS | **BLOCKED (credit)**: "no credits remaining"; it has never succeeded | `provider_health_state` | Same as Anthropic |
| **OpenRouter** | `OPENROUTER_API_KEY` (optional) | LLM aggregator | Not configured; optional by founder directive | 19 free models were found by discovery (public list) | None. A key is optional |
| **ElevenLabs** | `ELEVENLABS_API_KEY` | TTS (paid) | Untested. `allowPaid=false` excludes it from routing | `fkaios_resource_capabilities` | Paid: needs founder authorisation |
| **Self-hosted speech/LLM** | `SELF_HOSTED_SPEECH_BASE_URL` | Local STT, TTS, LLM | **Not configured.** The adapters exist and are tested in code | env check, 8 Oct | Founder provides a host if local inference is wanted |
| **WhatsApp (Meta Cloud API)** | `WHATSAPP_ACCESS_TOKEN` | Send and receive messages | Discovered; never sent. Sending requires founder approval per message, enforced by `approvals` | communications self-test plan; 0 sends | Founder approves a first real message in the Console |
| **Gmail / Google Calendar** | none | Email, calendar | **Not connected** (`connectors` table) | — | OAuth authorisation by the founder |
| **Netlify** | `NETLIFY_AUTH_TOKEN` | Deploy websites | Recorded as "connected" in the seed. 11 builds are deployed with a URL (5–6 Oct) | `build_projects.deployed_url` | — |
| **Nominatim (OpenStreetMap)** | none | Geocoding for maps and leads | **BLOCKED externally**: "Access denied" to the edge egress IPs. Failure is bounded | maps-engine v62 | Swap to a keyed geocoder only with founder approval |
| **MCP registry, GitHub, Hugging Face, OpenRouter list** | `GITHUB_TOKEN` optional | Read-only discovery | **VERIFIED**: scheduled run 9 Oct 02:51 UTC; all 6 sources answered; 180 candidates | discovery run 716b1eb9, evidence 6818b1c1 | — |
| **Supabase** (database, Storage, Edge) | platform | Everything | VERIFIED | — | — |
| **GitHub repository** | CI secret `SUPABASE_ACCESS_TOKEN` | Function deploy path | VERIFIED (run 111, 9 Oct 02:51) | Actions | — |

## Rules

- The `connectors` table (static, from 8 Jul) is **not** the source of truth for health. `provider_health_state` and the resource tables are.
- New connectors are added as rows in `fkaios_resource_capabilities` (capability → resource). The `credential_ref` column holds a variable name only, and a CHECK constraint enforces that.
- Paid resources are excluded from routing unless `allowPaid` is set by founder authorisation.
