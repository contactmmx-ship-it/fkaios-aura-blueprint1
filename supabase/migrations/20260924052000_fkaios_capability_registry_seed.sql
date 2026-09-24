-- Seed the FKAIOS capability registry from what was verified on 2026-09-24.
-- Credential STATE only, never values. Re-runnable (upsert on name).
-- Router: unknown availability is allowed but ranked last; the receiving
-- worker's verification step is what confirms it.
create or replace function public.fkaios_select_worker(required text[], exclude text[] default '{}')
returns table(name text, provider text, availability text, cost_state text, priority integer)
language sql stable as $$
  select r.name, r.provider, r.availability, r.cost_state, r.priority
  from public.capability_registry r
  where r.kind in ('coding_worker','ai_model')
    and r.handoff_support
    and r.capabilities @> required
    and not (r.name = any(exclude))
    and r.availability <> 'unavailable'
    and r.cost_state <> 'paid_exhausted'
  order by case r.availability when 'available' then 0 when 'degraded' then 1 else 2 end,
           (r.cost_state in ('free','paid_active')) desc,
           r.priority asc
$$;
revoke all on function public.fkaios_select_worker(text[], text[]) from public, anon, authenticated;

insert into public.capability_registry
  (name, kind, provider, purpose, endpoint, capabilities, operations, auth_state, cost_state, availability, permissions, limitations, handoff_support, priority, last_tested_at, last_success_at, source, metadata)
values
-- Coding workers: Claude Code sessions (Claude Code plan, separate from FKAIOS's ANTHROPIC_API_KEY)
('claude-code:claude-opus-5-5','coding_worker','anthropic','Engineering worker: reads/edits repos, runs SQL, deploys edge functions, pushes git, generates office artifacts','claude.ai/code session',
 array['repo_edit','sql','deploy_edge_functions','git_push','web_fetch','artifacts'], array['code','test','deploy','migrate','xlsx','pdf','docx','pptx'],
 'configured','paid_active','available', array['push:contactmmx-ship-it/fkaios-aura-blueprint1','supabase:nrlsqshkjuuwiovthrnb','vercel:fkaios-aura-blueprint1'],
 'Session context is finite; hands off via worker_handoffs.', true, 10, now(), now(), 'verified: this worker is running (build objective run)', '{}'),
('claude-code:claude-sonnet-5','coding_worker','anthropic','Engineering worker (Claude Code session)','claude.ai/code session',
 array['repo_edit','sql','deploy_edge_functions','git_push','web_fetch','artifacts'], array['code','test','deploy','migrate','xlsx','pdf','docx','pptx'],
 'configured','paid_active','unknown', '{}', 'Not yet exercised in this build; availability confirmed only by starting a session.', true, 20, null, null, 'registered: model id listed for Claude Code sessions', '{}'),
('claude-code:claude-fable-5-1','coding_worker','anthropic','Engineering worker (Claude Code session)','claude.ai/code session',
 array['repo_edit','sql','deploy_edge_functions','git_push','web_fetch','artifacts'], array['code','test','deploy','migrate'],
 'configured','paid_active','unknown', '{}', 'Not yet exercised in this build.', true, 30, null, null, 'registered: model id listed for Claude Code sessions', '{}'),
('claude-code:claude-haiku-4-5','coding_worker','anthropic','Lighter engineering worker (Claude Code session)','claude.ai/code session',
 array['repo_edit','sql','git_push'], array['code','test'],
 'configured','paid_active','unknown', '{}', 'Smaller model; not suited to large multi-file changes.', true, 60, null, null, 'registered: model id listed for Claude Code sessions', '{}'),
-- FKAIOS runtime LLMs (via _shared/llm-router.ts). They reason/plan inside FKAIOS; they cannot edit repositories.
('fkaios-llm:anthropic','ai_model','anthropic','FKAIOS runtime reasoning (claude-sonnet-4-6 / claude-haiku-4-5)','_shared/llm-router.ts',
 array['reasoning','planning','json_output'], array['callLLM'], 'configured','paid_exhausted','unavailable', '{}',
 'Anthropic API: "Your credit balance is too low" since 2026-09-22.', false, 10, now(), '2026-09-22T18:40:45Z', 'provider_health_state + agent_performance_metrics', '{}'),
('fkaios-llm:gemini','ai_model','google','FKAIOS runtime reasoning (gemini-3.5-flash-lite)','_shared/llm-router.ts',
 array['reasoning','planning','json_output'], array['callLLM'], 'configured','quota_limited','degraded', '{}',
 'Free-tier daily quota: 129 successful calls on 2026-09-23 then HTTP 429 for the rest of the day.', false, 20, now(), '2026-09-23T18:50:07Z', 'provider_health_state + agent_performance_metrics', '{}'),
('fkaios-llm:openai','ai_model','openai','FKAIOS runtime reasoning (gpt-4o-mini)','_shared/llm-router.ts',
 array['reasoning','planning','json_output'], array['callLLM'], 'missing','unknown','unavailable', '{}',
 'Never attempted by the router: OPENAI_API_KEY is not set as an Edge Function secret (model_registry). connectors row says "connected" but is stale.', false, 30, now(), null, 'model_registry + agent_performance_metrics', '{}'),
-- Research / knowledge tools
('research-engine','tool','apify','Real Google web search (Apify google-search-scraper); results stored in research_runs','supabase/functions/research-engine',
 array['web_search','external_research'], array['status','run'], 'configured','paid_active','available',
 array['run: explicit human or orchestrator-approved request only (spends Apify credits)'],
 'Auth accepts ANY Authorization header (verify_jwt=false) - anyone with the URL can spend credits. Not yet allowed for objective workers.', false, 100, now(), '2026-09-24T04:16:18Z', 'verified 2026-09-24: status connected as Franchise_Kart; 136 runs', '{}'),
('vault-engine','tool','supabase','Internal knowledge vault: ingest + semantic search (gte-small, match_knowledge_chunks)','supabase/functions/vault-engine',
 array['knowledge_search','knowledge_ingest'], array['search','ingest_document','ingest_all'], 'configured','free','available',
 array['requires x-vault-secret'], 'Holds only the FKAIOS System Charter (no market data). Irrelevant chunks score ~0.75-0.80 similarity.', false, 100, now(), now(), 'verified 2026-09-24: authenticated search HTTP 200', '{}'),
('web-crawler','tool','apify','Crawl a website and extract contacts/keywords','supabase/functions/web-crawler',
 array['web_crawl'], array['crawl'], 'missing','unknown','unknown', '{}',
 'Reads APIFY_API_TOKEN env var, which HANDOFF.md reports does not exist (token lives in apify_connections). Untested.', false, 100, null, null, 'code inspection', '{}'),
('maps-engine','tool','openstreetmap','Business/place lookup via OpenStreetMap (free)','supabase/functions/maps-engine',
 array['places_lookup'], array['search'], 'not_required','free','available', '{}',
 'OSM had no coverage for small Indian businesses (0/8 enriched, HANDOFF.md).', false, 100, null, null, 'HANDOFF.md', '{}'),
('knowledge-search','tool','supabase','Legacy semantic search','supabase/functions/knowledge-search',
 array['knowledge_search'], array['search'], 'unknown','unknown','unavailable', '{}',
 'Dead code: calls semantic_search_knowledge RPC that does not exist. Superseded by vault-engine.', false, 900, null, null, 'code inspection (file header)', '{}'),
('founder-objective','edge_function','fkaios','Objective API for the Command Center and Rajeev AI: submit, status, rerun','supabase/functions/founder-objective',
 array['objective_submit','objective_status','objective_rerun'], array['submit','status','rerun'], 'configured','free','available',
 array['signed-in user JWT; FOUNDER_EMAILS allow-list'], null, false, 100, now(), now(), 'deployed v4', '{}'),
('founder-brain-tick','edge_function','fkaios','Objective loop, planning, work allocation, Founder Brain cycle (cron every 15 min)','supabase/functions/founder-brain-tick',
 array['objective_loop','planning','orchestration'], array['tick'], 'configured','free','available', '{}',
 'Needs a working runtime LLM (fkaios-llm:*) to plan/evaluate.', false, 100, now(), now(), 'deployed v21', '{}'),
('ai-engine','edge_function','fkaios','Executes ai_jobs (work_engine_task) via assigned AI employees','supabase/functions/ai-engine',
 array['task_execution'], array['run_jobs'], 'configured','free','available', '{}',
 'Workers may request only knowledge.search and research.status.', false, 100, null, null, 'deployed v68', '{}'),
-- Artifact tools
('invoice-pdf','artifact_tool','fkaios','Invoice PDF generation inside FKAIOS','supabase/functions/invoice-pdf',
 array['artifact_pdf'], array['generate'], 'configured','free','unknown', '{}', 'Invoices only.', false, 100, null, null, 'code inspection', '{}'),
('claude-skills:office','artifact_tool','anthropic','Excel, Word, PowerPoint and PDF creation by a Claude Code worker','Claude Code skills (xlsx, docx, pptx, pdf)',
 array['artifact_xlsx','artifact_docx','artifact_pptx','artifact_pdf'], array['create','edit'], 'configured','paid_active','available', '{}',
 'Only inside a Claude Code worker session, not callable from FKAIOS runtime.', false, 100, now(), null, 'skills listed in this worker session', '{}'),
-- Repositories
('repo:fkaios-aura-blueprint1','repository','github','FKAIOS: Next.js console (Vercel) + Supabase edge functions','https://github.com/contactmmx-ship-it/fkaios-aura-blueprint1',
 array['fkaios','command_center','edge_functions'], '{}', 'configured','free','available', array['push'], null, false, 10, now(), now(), 'inspected 2026-09-24; main = caf0a31', '{"status":"active","production":"https://fkaios-aura-blueprint1.vercel.app"}'),
('repo:rajeev_ai','repository','github','Rajeev AI V1-V7: realtime voice (OpenAI Realtime/WebRTC), memory, FK Expansion Readiness methodology, projects, governed agents','https://github.com/contactmmx-ship-it/rajeev_ai',
 array['voice','rajeev_ai'], '{}', 'configured','free','available', array['read'],
 'Delivered as a zip; own Supabase schema not applied to FKAIOS; never run live; needs OPENAI_API_KEY for voice.', false, 20, now(), null, 'inspected 2026-09-24', '{"classification":{"keep":["voice UI","methodology"],"modify":["memory -> FKAIOS Brain"],"integrate":["founder-objective API"],"missing":["deployment","live test"]}}'),
('repo:syros-opd-console-frontend','repository','github','Syros OPD console frontend','https://github.com/contactmmx-ship-it/syros-opd-console-frontend', array['syros'], '{}', 'configured','free','unknown', array['push'], 'Not inspected yet.', false, 50, null, null, 'list_repos', '{}'),
('repo:syros-opd-console-backend','repository','github','Syros OPD console backend','https://github.com/contactmmx-ship-it/syros-opd-console-backend', array['syros'], '{}', 'configured','free','unknown', array['push'], 'Not inspected yet.', false, 50, null, null, 'list_repos', '{}'),
('repo:franchise-kart-crm','repository','github','Franchise Kart CRM','https://github.com/contactmmx-ship-it/franchise-kart-crm', array['crm','franchise_kart'], '{}', 'configured','free','unknown', array['push'], 'Not inspected yet.', false, 50, null, null, 'list_repos', '{}')
on conflict (name) do update set
  kind = excluded.kind, provider = excluded.provider, purpose = excluded.purpose, endpoint = excluded.endpoint,
  capabilities = excluded.capabilities, operations = excluded.operations, auth_state = excluded.auth_state,
  cost_state = excluded.cost_state, availability = excluded.availability, permissions = excluded.permissions,
  limitations = excluded.limitations, handoff_support = excluded.handoff_support, priority = excluded.priority,
  last_tested_at = excluded.last_tested_at, last_success_at = excluded.last_success_at, source = excluded.source,
  metadata = excluded.metadata, updated_at = now();

-- Connectors table rows, as registry entries (state only).
insert into public.capability_registry (name, kind, provider, purpose, capabilities, auth_state, availability, source)
select 'connector:' || c.name, 'connector', c.name, c.category || ' connector (' || c.auth_method || ')', array[c.category],
       case when c.status = 'connected' then 'configured' else 'missing' end,
       case when c.status = 'connected' then 'unknown' else 'unavailable' end,
       'connectors table (status=' || c.status || ', never health-checked)'
from public.connectors c
on conflict (name) do update set auth_state = excluded.auth_state, availability = excluded.availability, source = excluded.source, updated_at = now();
