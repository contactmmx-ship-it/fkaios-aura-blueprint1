-- =====================================================================
-- DEALER CRM — 002: COMMERCIAL CHAIN (deals → proposals → invoices)
-- Wave 1 | Agent: Database Architect
--
-- THE POINT OF THIS MIGRATION: the parent enterprise (FKAIOS) discovered that its
-- commercial chain silently terminated at stage 3 — 67 leads scored, ZERO ever
-- advanced, 0 projects, 0 invoices, ₹0 revenue. Nothing in the schema prevented a
-- broken chain, so nobody noticed it was broken for months.
--
-- Here the chain dealer → deal → proposal → invoice is enforced BY THE DATABASE.
-- You cannot invoice without a proposal. You cannot propose without a deal. The
-- structure makes a silently dead funnel impossible to hide.
-- =====================================================================

CREATE TYPE deal_stage AS ENUM (
  'discovery','qualified','proposed','negotiation','won','lost'
);

CREATE TABLE public.deals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dealer_id        uuid NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  lead_id          uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  title            text NOT NULL,
  stage            deal_stage NOT NULL DEFAULT 'discovery',
  -- Value is NULLABLE and has NO default. A deal with an invented value is worse than
  -- a deal with no value: it corrupts every forecast built on top of it.
  value_inr        numeric CHECK (value_inr IS NULL OR value_inr >= 0),
  expected_close   date,
  lost_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- A lost deal must say why. Unexplained losses teach the company nothing.
  CONSTRAINT lost_requires_reason
    CHECK (stage <> 'lost' OR length(trim(coalesce(lost_reason,''))) > 3),
  -- A won deal must carry a value. "We won something, amount unknown" is how revenue
  -- forecasts become fiction.
  CONSTRAINT won_requires_value
    CHECK (stage <> 'won' OR value_inr IS NOT NULL)
);
CREATE INDEX idx_deals_owner_stage ON public.deals (owner_user_id, stage);
CREATE INDEX idx_deals_dealer      ON public.deals (dealer_id);

CREATE TABLE public.proposals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id             uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  scope               text NOT NULL,
  -- UNKNOWNS are first-class. A proposal that hides what it does not know is a
  -- liability disguised as a document.
  unknowns            text[] NOT NULL DEFAULT '{}',
  -- PRICE IS A HUMAN DECISION. AI may draft scope; it may not set a fee.
  price_inr           numeric CHECK (price_inr IS NULL OR price_inr >= 0),
  approved_by_user_id uuid REFERENCES auth.users(id),
  approved_at         timestamptz,
  sent_at             timestamptz,
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','pending_approval','approved','sent','accepted','rejected')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- A proposal cannot be APPROVED without a human approver AND a price.
  -- This is the money-gate, enforced by Postgres rather than by good intentions.
  CONSTRAINT approval_requires_human_and_price
    CHECK (status NOT IN ('approved','sent','accepted')
           OR (approved_by_user_id IS NOT NULL AND price_inr IS NOT NULL AND approved_at IS NOT NULL)),
  -- It cannot be SENT before it was approved.
  CONSTRAINT sent_after_approved
    CHECK (sent_at IS NULL OR approved_at IS NOT NULL)
);
CREATE INDEX idx_proposals_deal ON public.proposals (deal_id, status);

CREATE TABLE public.invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- THE CHAIN IS ENFORCED: no invoice can exist without a proposal behind it.
  proposal_id         uuid NOT NULL REFERENCES public.proposals(id) ON DELETE RESTRICT,
  invoice_number      text NOT NULL UNIQUE,
  subtotal_inr        numeric NOT NULL CHECK (subtotal_inr >= 0),
  tax_inr             numeric NOT NULL DEFAULT 0 CHECK (tax_inr >= 0),
  total_inr           numeric GENERATED ALWAYS AS (subtotal_inr + tax_inr) STORED,
  amount_received_inr numeric NOT NULL DEFAULT 0 CHECK (amount_received_inr >= 0),
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','pending_approval','approved','sent','part_paid','paid','void')),
  approved_by_user_id uuid REFERENCES auth.users(id),
  sent_at             timestamptz,
  payment_received_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- AI NEVER MOVES MONEY. An invoice cannot leave the building without a human.
  CONSTRAINT send_requires_human_approval
    CHECK (status NOT IN ('approved','sent','part_paid','paid')
           OR approved_by_user_id IS NOT NULL),
  -- Cannot receive more than was billed.
  CONSTRAINT no_overpayment
    CHECK (amount_received_inr <= subtotal_inr + tax_inr),
  -- 'paid' must actually mean paid. This is the constraint that makes revenue
  -- reporting impossible to fake: you cannot mark an invoice paid with ₹0 received.
  CONSTRAINT paid_means_money_arrived
    CHECK (status <> 'paid' OR (amount_received_inr = subtotal_inr + tax_inr
                                AND payment_received_at IS NOT NULL))
);
CREATE INDEX idx_invoices_proposal ON public.invoices (proposal_id);
CREATE INDEX idx_invoices_status   ON public.invoices (owner_user_id, status);

ALTER TABLE public.deals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices  ENABLE ROW LEVEL SECURITY;

CREATE POLICY deals_owner ON public.deals FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY proposals_owner ON public.proposals FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY invoices_owner ON public.invoices FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE TRIGGER trg_deals_touch BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
