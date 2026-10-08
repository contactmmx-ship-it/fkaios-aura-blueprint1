-- FKAIOS capability → resource index (mission 2026-10-08).
-- The architecture is CAPABILITY → RESOURCES → selection, not "which API key do
-- I have". model_registry stays the registry of text-generation models; this
-- table says which resources can provide each capability (speech_to_text,
-- text_to_speech, communications, …), at what tier, privacy, cost and
-- infrastructure, with lifecycle and health per (capability, resource).
--
-- credential_ref holds the NAME of the environment variable the resource
-- needs, never a value: the check constraint only admits an env-var name.
-- Whether it is configured is decided at run time inside the edge function.

set local lock_timeout = '5s';

create table if not exists public.fkaios_resource_capabilities (
  id uuid primary key default gen_random_uuid(),
  capability text not null check (capability in (
    'speech_to_text', 'text_to_speech',
    'send_message', 'send_whatsapp_message', 'send_email', 'send_sms', 'make_voice_call',
    'receive_message', 'receive_whatsapp_message', 'receive_email', 'receive_voice_call')),
  resource_ref text not null check (resource_ref ~ '^(model|tool|worker):'),
  provider text not null,
  display_name text,
  tier text not null check (tier in ('local', 'self_hosted', 'internal', 'free_external', 'low_cost_external', 'paid_premium')),
  credential_ref text check (credential_ref is null or credential_ref ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  privacy_class text not null check (privacy_class in ('local', 'self_hosted', 'external')),
  cost_model jsonb not null default '{}'::jsonb,
  infra_requirements jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  operations text[] not null default '{}',
  requires_approval boolean not null default false,
  lifecycle_state text not null default 'discovered' check (lifecycle_state in ('discovered', 'available', 'testing', 'verified', 'candidate', 'adopted', 'monitored', 'degraded', 'retired')),
  health_status text not null default 'unknown' check (health_status in ('available', 'degraded', 'unavailable', 'unknown')),
  unavailable_until timestamptz,
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_category text,
  evidence_id uuid references public.fkaios_verification_evidence(id),
  source text not null default 'seed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (capability, resource_ref)
);

alter table public.fkaios_resource_capabilities enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fkaios_resource_capabilities' and policyname = 'fkaios_resource_capabilities_read') then
    create policy fkaios_resource_capabilities_read on public.fkaios_resource_capabilities for select to authenticated using (true);
  end if;
end $p$;

-- Known resources. Lifecycle reflects evidence, not intent: nothing below is
-- 'verified' until a production test writes evidence for it.
insert into public.fkaios_resource_capabilities
  (capability, resource_ref, provider, display_name, tier, credential_ref, privacy_class, cost_model, infra_requirements, limits, operations, requires_approval, lifecycle_state, metadata)
values
  ('speech_to_text', 'tool:self_hosted:faster-whisper', 'self_hosted', 'faster-whisper (OpenAI-compatible speech server, e.g. speaches)', 'local', 'SELF_HOSTED_SPEECH_BASE_URL', 'local',
   '{"api_usd": 0, "note": "zero API cost; infrastructure cost is the host"}', '{"runtime": "speaches or faster-whisper-server", "cpu_ok": true, "gpu": "optional, ~10x faster", "ram_gb": 4, "model": "Systran/faster-whisper-small or larger"}',
   '{"max_audio_mb": 25}', '{transcribe,language_detection,timestamps}', false, 'discovered', '{"endpoint": "/v1/audio/transcriptions", "license": "MIT (faster-whisper), MIT (Whisper weights)"}'),
  ('speech_to_text', 'model:gemini:gemini-3.5-flash-lite', 'gemini', 'Gemini 3.5 Flash-Lite (audio input)', 'free_external', 'GEMINI_API_KEY', 'external',
   '{"api_usd": 0, "note": "free tier, daily quota"}', '{}', '{"max_inline_audio_mb": 20}', '{transcribe,language_detection}', false, 'testing', '{"endpoint": "generateContent with inline audio"}'),
  ('speech_to_text', 'model:openai:gpt-4o-mini-transcribe', 'openai', 'OpenAI gpt-4o-mini-transcribe', 'paid_premium', 'OPENAI_API_KEY', 'external',
   '{"usd_per_minute": 0.003}', '{}', '{"max_audio_mb": 25}', '{transcribe}', false, 'discovered', '{"endpoint": "/v1/audio/transcriptions"}'),
  ('text_to_speech', 'tool:self_hosted:kokoro', 'self_hosted', 'Kokoro / Piper (OpenAI-compatible speech server)', 'local', 'SELF_HOSTED_SPEECH_BASE_URL', 'local',
   '{"api_usd": 0, "note": "zero API cost; infrastructure cost is the host"}', '{"runtime": "speaches, Kokoro-FastAPI or openedai-speech (Piper)", "cpu_ok": true, "ram_gb": 2}',
   '{}', '{synthesize}', false, 'discovered', '{"endpoint": "/v1/audio/speech", "license": "Apache-2.0 (Kokoro-82M), MIT (Piper)"}'),
  ('text_to_speech', 'tool:elevenlabs:tts', 'elevenlabs', 'ElevenLabs multilingual v2', 'paid_premium', 'ELEVENLABS_API_KEY', 'external',
   '{"usd_per_1k_chars": 0.18}', '{}', '{}', '{synthesize,voice_selection}', false, 'discovered', '{"voice_ref": "AVATAR_VOICE_ID"}'),
  ('text_to_speech', 'model:openai:gpt-4o-mini-tts', 'openai', 'OpenAI gpt-4o-mini-tts', 'paid_premium', 'OPENAI_API_KEY', 'external',
   '{"usd_per_1m_chars": 12}', '{}', '{}', '{synthesize,voice_selection}', false, 'discovered', '{"endpoint": "/v1/audio/speech"}'),
  ('send_whatsapp_message', 'tool:meta:whatsapp-cloud-api', 'meta', 'WhatsApp Business Cloud API', 'low_cost_external', 'WHATSAPP_ACCESS_TOKEN', 'external',
   '{"note": "Meta per-conversation pricing; template required outside the 24 h window"}', '{}', '{"session_window_hours": 24}', '{send_text,send_template}', true, 'discovered',
   '{"phone_number_ref": "WHATSAPP_PHONE_NUMBER_ID", "authorization": "Meta Business verified number; outbound to opted-in recipients only"}'),
  ('receive_whatsapp_message', 'tool:meta:whatsapp-cloud-api', 'meta', 'WhatsApp Business Cloud API (webhook)', 'low_cost_external', 'WHATSAPP_ACCESS_TOKEN', 'external',
   '{}', '{}', '{}', '{receive_text}', false, 'discovered', '{"endpoint": "whatsapp-webhook-v2"}')
on conflict (capability, resource_ref) do nothing;
