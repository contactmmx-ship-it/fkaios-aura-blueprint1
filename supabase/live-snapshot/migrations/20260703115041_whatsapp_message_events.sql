-- Applied in production as version 20260703115041 (whatsapp_message_events).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 1f17d5d09eb9d25f75a2a5f2c04be6b0).
-- Record only: do not apply from this folder.

-- Tracks every inbound WhatsApp message (not just first-ever from a number)
-- so the AI can reply to ongoing conversations, not just brand-new leads.
CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_messages (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id       uuid REFERENCES public.leads(id) ON DELETE CASCADE,
    phone         text NOT NULL,
    message_text  text NOT NULL,
    whatsapp_id   text,
    replied       boolean NOT NULL DEFAULT false,
    replied_at    timestamptz,
    reply_text    text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_unreplied ON public.whatsapp_inbound_messages (replied, created_at) WHERE replied = false;

ALTER TABLE public.whatsapp_inbound_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_inbound_select ON public.whatsapp_inbound_messages;
CREATE POLICY wa_inbound_select ON public.whatsapp_inbound_messages FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = auth.uid() AND c.role IN ('Founder','OpsHead')));
