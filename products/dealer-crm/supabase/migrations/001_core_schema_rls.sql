-- =====================================================================
-- DEALER CRM — 001: CORE SCHEMA & RLS
-- Manufactured by the FK AIOS Software Factory.
-- Project: Dealer CRM  |  Wave 1  |  Task: dealers, contacts, leads, bant_scores
-- Agent: Database Architect
--
-- TARGET: a NEW Supabase project for the Dealer CRM product.
-- DELIBERATELY NOT APPLIED to the FKAIOS enterprise database — a product's schema
-- does not belong in the holding company's operational DB. Deployment to the product
-- project is BLOCKED on credentials for that project (Founder gate). The code is real
-- and reviewed; only the apply step waits.
-- =====================================================================

-- Every table is row-scoped by owner_user_id. RLS is ON before a single row exists,
-- because retrofitting RLS onto a populated table is how data leaks happen.

CREATE TABLE public.dealers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_name        text NOT NULL,
  trade_name        text,
  gstin             text,
  city              text NOT NULL,
  state             text,
  territory         text,
  -- Commercial terms. NEVER exposed to anon (see 004 hardening).
  credit_limit_inr  numeric CHECK (credit_limit_inr IS NULL OR credit_limit_inr >= 0),
  margin_pct        numeric CHECK (margin_pct IS NULL OR (margin_pct >= 0 AND margin_pct <= 100)),
  status            text NOT NULL DEFAULT 'prospect'
                    CHECK (status IN ('prospect','onboarding','active','dormant','terminated')),
  onboarded_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- A dealer cannot be 'active' without an onboarding date. The DB enforces the
  -- lifecycle rather than trusting the UI to.
  CONSTRAINT active_requires_onboarding
    CHECK (status <> 'active' OR onboarded_at IS NOT NULL)
);
CREATE INDEX idx_dealers_owner   ON public.dealers (owner_user_id, status);
CREATE INDEX idx_dealers_city    ON public.dealers (city);
CREATE UNIQUE INDEX uq_dealers_gstin ON public.dealers (gstin) WHERE gstin IS NOT NULL;

CREATE TABLE public.contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dealer_id      uuid REFERENCES public.dealers(id) ON DELETE CASCADE,
  full_name      text NOT NULL,
  phone          text,
  email          text,
  designation    text,
  is_primary     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- An unreachable contact is not a contact. This is the exact defect that made the
  -- parent enterprise's funnel un-qualifiable (best BANT 32 vs a bar of 40): leads
  -- with no phone and no email. The schema refuses to repeat it.
  CONSTRAINT contact_must_be_reachable
    CHECK (COALESCE(NULLIF(trim(phone),''), NULLIF(trim(email),'')) IS NOT NULL)
);
CREATE INDEX idx_contacts_dealer ON public.contacts (dealer_id);
CREATE INDEX idx_contacts_owner  ON public.contacts (owner_user_id);
-- At most one primary contact per dealer.
CREATE UNIQUE INDEX uq_primary_contact ON public.contacts (dealer_id) WHERE is_primary;

CREATE TABLE public.leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dealer_id           uuid REFERENCES public.dealers(id) ON DELETE SET NULL,
  contact_name        text NOT NULL,
  phone               text,
  email               text,
  city                text,
  investment_capacity numeric,
  source              text NOT NULL DEFAULT 'inbound',
  stage               text NOT NULL DEFAULT 'new'
                      CHECK (stage IN ('new','contacted','qualified','proposed','won','lost')),
  -- CRITICAL, learned the hard way in the parent system: lead_score has NO DEFAULT.
  -- FKAIOS had `DEFAULT 0`, and the qualifier selected unscored leads with
  -- `WHERE lead_score IS NULL` — so every inbound lead was born at 0, was NEVER seen
  -- by the qualifier, and sat unscored forever. NULL means "not yet scored", and it
  -- must be the only way a new lead can start.
  lead_score          integer CHECK (lead_score IS NULL OR (lead_score BETWEEN 0 AND 100)),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_must_be_reachable
    CHECK (COALESCE(NULLIF(trim(phone),''), NULLIF(trim(email),'')) IS NOT NULL)
);
CREATE INDEX idx_leads_owner_stage ON public.leads (owner_user_id, stage);
-- Partial index: the qualifier's hot path is "find unscored leads".
CREATE INDEX idx_leads_unscored ON public.leads (created_at) WHERE lead_score IS NULL;

CREATE TABLE public.bant_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id        uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  budget         integer NOT NULL CHECK (budget    BETWEEN 0 AND 25),
  authority      integer NOT NULL CHECK (authority BETWEEN 0 AND 25),
  need           integer NOT NULL CHECK (need      BETWEEN 0 AND 25),
  timeline       integer NOT NULL CHECK (timeline  BETWEEN 0 AND 25),
  total          integer GENERATED ALWAYS AS (budget + authority + need + timeline) STORED,
  reasoning      text NOT NULL,
  model          text NOT NULL,          -- LLM execution graph: which model scored this
  scored_at      timestamptz NOT NULL DEFAULT now(),
  -- A score with no reasoning is an unauditable number. Refuse it.
  CONSTRAINT reasoning_required CHECK (length(trim(reasoning)) > 10)
);
CREATE INDEX idx_bant_lead ON public.bant_scores (lead_id, scored_at DESC);

-- ---------------- RLS: on from birth, not bolted on later ----------------
ALTER TABLE public.dealers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bant_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY dealers_owner ON public.dealers
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY contacts_owner ON public.contacts
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY leads_owner ON public.leads
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY bant_owner ON public.bant_scores
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- NOTE: anon gets NO policy at all. Absence of a policy under RLS = deny.
-- Public read (if ever needed) must go through a server-side function that hand-picks
-- marketing-safe columns — because RLS is ROW-level, not COLUMN-level, and a policy
-- granting anon read here would expose credit_limit_inr and margin_pct.
-- This is the exact mistake avoided in the parent system's brands table.

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER trg_dealers_touch BEFORE UPDATE ON public.dealers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_leads_touch BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
