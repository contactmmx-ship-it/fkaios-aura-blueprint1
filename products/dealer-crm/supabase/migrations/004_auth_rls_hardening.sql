-- =====================================================================
-- DEALER CRM — 004: AUTH ROLES & RLS HARDENING
-- Wave 1 | Agent: Security Engineer
--
-- THE ATTACK THIS PREVENTS IS ONE THE PARENT SYSTEM NEARLY SHIPPED:
-- To serve a public page, the obvious move is "add an anon SELECT policy". That is
-- WRONG, and the reason is subtle enough that it is worth encoding here permanently:
--
--   POSTGRES RLS IS ROW-LEVEL, NOT COLUMN-LEVEL.
--
-- An anon SELECT policy on `dealers` does not expose "some of dealers" — it exposes
-- EVERY COLUMN of the permitted rows, including credit_limit_inr and margin_pct. Your
-- commercial terms would be published to every competitor with a browser, and the
-- policy would look perfectly reasonable in review.
--
-- The correct pattern (proven in the parent system's brands-public/products-public):
-- anon gets NO table policy at all. Public reads go through a SECURITY DEFINER function
-- that HAND-PICKS marketing-safe columns. The commercial columns are never reachable,
-- not merely "not selected".
-- =====================================================================

-- ---------- 1. Roles ----------
-- Supabase gives us: anon, authenticated, service_role.
-- Application roles are claims, not DB roles — this keeps RLS simple and auditable.
CREATE TABLE public.user_roles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('founder','internal_user')),
  granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- A user may read their OWN role. They may not read anyone else's, and they may not
-- grant themselves one — privilege escalation via a self-INSERT is the classic hole.
CREATE POLICY roles_read_self ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- NO insert/update policy for authenticated. Only service_role (server-side) may grant.

CREATE OR REPLACE FUNCTION public.is_founder()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'founder');
$$;

-- ---------- 2. The money gate, enforced in the database ----------
-- Only a FOUNDER may set a price or approve an invoice. Not the app. Not an AI.
-- A UI check is a suggestion; a trigger is a rule.
--
-- ⚠ TWO HOLES FOUND IN ADVERSARIAL REVIEW OF THE FIRST DRAFT OF THIS FILE — both
--   would have shipped, and both are recorded here so the mistake is never repeated:
--
--   HOLE 1 — INSERT WAS NOT COVERED. The trigger fired only BEFORE UPDATE. An
--   INSERT of a proposal already carrying status='approved' and a price sailed
--   straight past the gate. The CHECK constraint demanded an approved_by_user_id,
--   but an internal user could simply supply THEIR OWN id. Fixed: the trigger now
--   fires on INSERT and UPDATE.
--
--   HOLE 2 — THE AI COULD WALK THROUGH THE GATE. The first draft let service_role
--   bypass the check (auth.uid() IS NULL -> RETURN NEW). EVERY AI ENGINE IN THIS
--   COMPANY RUNS AS service_role. I had written a money-gate that the AI could open,
--   in a file whose own comment said "AI NEVER MOVES MONEY". Fixed: the gate no
--   longer cares WHO is executing. It cares that the APPROVER NAMED ON THE ROW is a
--   real founder. A service-role job may write the row; it cannot invent an approver.
CREATE OR REPLACE FUNCTION public.enforce_founder_pricing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_approver uuid;
  v_is_priced boolean;
  v_is_approved boolean;
BEGIN
  IF TG_TABLE_NAME = 'proposals' THEN
    v_approver    := NEW.approved_by_user_id;
    v_is_priced   := NEW.price_inr IS NOT NULL
                     AND (TG_OP = 'INSERT' OR NEW.price_inr IS DISTINCT FROM OLD.price_inr);
    v_is_approved := NEW.status IN ('approved','sent','accepted')
                     AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('approved','sent','accepted'));

    -- A PRICE may only exist on a row whose named approver is a real founder.
    -- This holds no matter who executes the statement — user, app, or AI.
    IF v_is_priced AND (v_approver IS NULL OR NOT public.user_is_founder(v_approver)) THEN
      RAISE EXCEPTION 'PRICING IS A FOUNDER DECISION. A price requires approved_by_user_id to be a founder. Row rejected.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_is_approved AND (v_approver IS NULL OR NOT public.user_is_founder(v_approver)) THEN
      RAISE EXCEPTION 'PROPOSAL APPROVAL IS A FOUNDER DECISION. Row rejected.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'invoices' THEN
    v_approver    := NEW.approved_by_user_id;
    v_is_approved := NEW.status IN ('approved','sent','part_paid','paid')
                     AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('approved','sent','part_paid','paid'));

    -- AI NEVER MOVES MONEY — and now that sentence is enforced rather than asserted.
    -- A service_role engine can draft an invoice. It cannot name a founder who did
    -- not approve it, because it cannot forge a row in user_roles (no policy grants
    -- INSERT there to anyone but service-side grant flows the founder controls).
    IF v_is_approved AND (v_approver IS NULL OR NOT public.user_is_founder(v_approver)) THEN
      RAISE EXCEPTION 'AI NEVER MOVES MONEY. Invoice approval requires approved_by_user_id to be a founder. Row rejected.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Founder check by EXPLICIT user id — not by "who is executing". That distinction is
-- the entire fix: identity of the approver, not identity of the caller.
CREATE OR REPLACE FUNCTION public.user_is_founder(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = 'founder');
$$;

-- INSERT **and** UPDATE. The first draft covered only UPDATE — hole 1.
CREATE TRIGGER trg_proposals_founder_gate
  BEFORE INSERT OR UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_founder_pricing();

CREATE TRIGGER trg_invoices_founder_gate
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_founder_pricing();

-- ---------- 3. Public surface: hand-picked columns ONLY ----------
-- NOTE what is ABSENT: credit_limit_inr, margin_pct, gstin, owner_user_id.
-- Not "excluded from the query" — UNREACHABLE. anon has no policy on public.dealers.
CREATE OR REPLACE FUNCTION public.public_dealer_directory()
RETURNS TABLE (trade_name text, city text, state text, territory text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.trade_name, d.city, d.state, d.territory
  FROM public.dealers d
  WHERE d.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.public_dealer_directory() FROM public;
GRANT EXECUTE ON FUNCTION public.public_dealer_directory() TO anon, authenticated;

-- ---------- 4. Deny-by-default proof ----------
-- Under RLS, absence of a policy = deny. anon has NO policy on any table above, so a
-- direct anon SELECT returns zero rows even without an explicit deny rule. This
-- comment exists so a future engineer does not "helpfully" add an anon policy and
-- publish the company's margins.
--
-- ANY future public read MUST go through a SECURITY DEFINER function like the one
-- above. No exceptions. This rule is not style — it is the difference between a
-- product and a data breach.
