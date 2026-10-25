-- Durable, provider-neutral handoff snapshots for cross-tool continuation.
-- The canonical objective state remains the source of truth; this table stores
-- versioned portable packets that another authorized executor can import.
create table if not exists public.fkaios_ai_continuity_packets (
  objective_id text primary key,
  packet jsonb not null,
  packet_version integer not null default 1,
  source_state_version bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fkaios_ai_continuity_packet_schema check (
    packet ->> 'schema' = 'fkaios.ai-continuity'
    and (packet ->> 'version')::integer = packet_version
  )
);

alter table public.fkaios_ai_continuity_packets enable row level security;
revoke all privileges on table public.fkaios_ai_continuity_packets from public, anon, authenticated;
grant all privileges on table public.fkaios_ai_continuity_packets to service_role;

comment on table public.fkaios_ai_continuity_packets is
  'Portable AI handoff snapshots. Service-role access only; never store credentials or secrets in packet JSON.';
