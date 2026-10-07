-- Applied in production as version 20260708162456 (connector_registry).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: d9e594d180f6999306fb63e721d34a05).
-- Record only: do not apply from this folder.


create table if not exists public.connectors (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  category text not null,
  auth_method text not null,
  status text not null default 'not_connected',
  config_schema jsonb,
  credentials_secret_name text,
  last_health_check_at timestamptz,
  last_health_check_status text,
  created_at timestamptz default now()
);

alter table public.connectors enable row level security;
drop policy if exists "connectors_service_role_full" on public.connectors;
create policy "connectors_service_role_full" on public.connectors for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "connectors_authenticated_read" on public.connectors;
create policy "connectors_authenticated_read" on public.connectors for select using (auth.role() = 'authenticated');

insert into public.connectors (name, category, auth_method, status, credentials_secret_name) values
('whatsapp_business', 'messaging', 'api_key', 'connected', 'WHATSAPP_TOKEN'),
('elevenlabs', 'voice', 'api_key', 'connected', 'ELEVENLABS_API_KEY'),
('netlify', 'deployment', 'api_key', 'connected', 'NETLIFY_AUTH_TOKEN'),
('anthropic', 'llm', 'api_key', 'connected', 'ANTHROPIC_API_KEY'),
('openai', 'llm', 'api_key', 'connected', 'OPENAI_API_KEY'),
('gmail', 'email', 'oauth2', 'not_connected', null),
('google_calendar', 'calendar', 'oauth2', 'not_connected', null)
on conflict (name) do nothing;
