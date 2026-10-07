-- Applied in production as version 20260708162447 (model_routing_rules).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: b7aa82dcc97dd91deb651136fe501d2d).
-- Record only: do not apply from this folder.


create table if not exists public.model_routing_rules (
  id uuid primary key default gen_random_uuid(),
  task_type text not null unique,
  priority text not null default 'balanced',
  preferred_provider text not null,
  preferred_model text not null,
  fallback_provider text,
  fallback_model text,
  max_input_tokens int,
  notes text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.model_routing_rules enable row level security;
drop policy if exists "model_routing_service_role_full" on public.model_routing_rules;
create policy "model_routing_service_role_full" on public.model_routing_rules for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "model_routing_authenticated_read" on public.model_routing_rules;
create policy "model_routing_authenticated_read" on public.model_routing_rules for select using (auth.role() = 'authenticated');

insert into public.model_routing_rules (task_type, priority, preferred_provider, preferred_model, fallback_provider, fallback_model, notes) values
('voice_intent_classify', 'speed', 'anthropic', 'claude-3-haiku-20240307', 'openai', 'gpt-4o-mini', 'Routing decision only — fast + cheap, not a reasoning task'),
('founder_general_chat', 'quality', 'anthropic', 'claude-sonnet-4-6', 'openai', 'gpt-4o', 'Founder-facing open conversation — best quality, any topic'),
('agent_structured_task', 'cost', 'anthropic', 'claude-3-haiku-20240307', 'openai', 'gpt-4o-mini', 'High-volume background agent JSON tasks — cheapest capable model'),
('business_reasoning', 'quality', 'anthropic', 'claude-sonnet-4-6', 'anthropic', 'claude-3-haiku-20240307', 'Deal analysis, business model math, decision engine'),
('app_build_request', 'quality', 'anthropic', 'claude-sonnet-4-6', 'openai', 'gpt-4o', 'Builder AI code generation')
on conflict (task_type) do nothing;
