-- Applied in production as version 20260619183000 (phase0_security_rbac).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 0905cfbfef19c1968abc8ddbf8d56f0d).
-- Record only: do not apply from this folder.


-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_consultant_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT id FROM consultants WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT role FROM consultants WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT COALESCE(get_my_role() IN ('Founder', 'OpsHead'), false);
$$;

CREATE OR REPLACE FUNCTION my_brand_ids()
RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT COALESCE(array_agg(brand_id), ARRAY[]::uuid[])
  FROM consultant_brands
  WHERE consultant_id = get_my_consultant_id();
$$;

-- ============================================================
-- AUTO-LINK NEW AUTH USERS TO CONSULTANT ROW
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE consultants
  SET auth_user_id = NEW.id
  WHERE email = NEW.email AND auth_user_id IS NULL;

  IF NOT FOUND THEN
    INSERT INTO consultants (auth_user_id, name, email, role)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      NEW.email,
      'RM'
    )
    ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- ============================================================
-- RLS POLICIES — BRANDS
-- ============================================================
CREATE POLICY "select_brands" ON brands FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_brands" ON brands FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_brands" ON brands FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_brands" ON brands FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- RLS POLICIES — CONSULTANT_BRANDS
-- ============================================================
CREATE POLICY "select_consultant_brands" ON consultant_brands FOR SELECT TO authenticated
  USING (is_admin() OR consultant_id = get_my_consultant_id());
CREATE POLICY "write_consultant_brands" ON consultant_brands FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- RLS POLICIES — CONSULTANTS
-- ============================================================
CREATE POLICY "select_consultants" ON consultants FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_consultants" ON consultants FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_consultants" ON consultants FOR UPDATE TO authenticated
  USING (is_admin() OR auth_user_id = auth.uid())
  WITH CHECK (is_admin() OR auth_user_id = auth.uid());
CREATE POLICY "delete_consultants" ON consultants FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- RLS POLICIES — LEADS
-- ============================================================
CREATE POLICY "select_leads" ON leads FOR SELECT TO authenticated USING (
  is_admin()
  OR get_my_role() = 'Accounts'
  OR assigned_to = get_my_consultant_id()
  OR brand_id = ANY (my_brand_ids())
);
CREATE POLICY "insert_leads" ON leads FOR INSERT TO authenticated WITH CHECK (
  is_admin() OR brand_id = ANY (my_brand_ids()) OR get_my_role() = 'RM'
);
CREATE POLICY "update_leads" ON leads FOR UPDATE TO authenticated
  USING (is_admin() OR assigned_to = get_my_consultant_id() OR brand_id = ANY (my_brand_ids()))
  WITH CHECK (is_admin() OR assigned_to = get_my_consultant_id() OR brand_id = ANY (my_brand_ids()));
CREATE POLICY "delete_leads" ON leads FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- RLS POLICIES — LEAD_ACTIVITIES, MEETINGS, DOCUMENTS
-- ============================================================
CREATE POLICY "select_lead_activities" ON lead_activities FOR SELECT TO authenticated USING (
  is_admin() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY (my_brand_ids())
  )
);
CREATE POLICY "insert_lead_activities" ON lead_activities FOR INSERT TO authenticated WITH CHECK (
  is_admin() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY (my_brand_ids())
  )
);
CREATE POLICY "update_lead_activities" ON lead_activities FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_lead_activities" ON lead_activities FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_meetings" ON meetings FOR SELECT TO authenticated USING (
  is_admin() OR consultant_id = get_my_consultant_id() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY (my_brand_ids())
  )
);
CREATE POLICY "insert_meetings" ON meetings FOR INSERT TO authenticated WITH CHECK (
  is_admin() OR consultant_id = get_my_consultant_id() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY (my_brand_ids())
  )
);
CREATE POLICY "update_meetings" ON meetings FOR UPDATE TO authenticated
  USING (is_admin() OR consultant_id = get_my_consultant_id())
  WITH CHECK (is_admin() OR consultant_id = get_my_consultant_id());
CREATE POLICY "delete_meetings" ON meetings FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_documents" ON documents FOR SELECT TO authenticated USING (
  is_admin() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY (my_brand_ids())
  )
);
CREATE POLICY "insert_documents" ON documents FOR INSERT TO authenticated WITH CHECK (
  is_admin() OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY (my_brand_ids())
  )
);
CREATE POLICY "update_documents" ON documents FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_documents" ON documents FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- RLS POLICIES — INVOICES & PAYMENTS
-- ============================================================
CREATE POLICY "select_invoices" ON invoices FOR SELECT TO authenticated USING (
  is_admin() OR get_my_role() = 'Accounts' OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id()
  )
);
CREATE POLICY "insert_invoices" ON invoices FOR INSERT TO authenticated WITH CHECK (
  is_admin() OR get_my_role() = 'Accounts'
);
CREATE POLICY "update_invoices" ON invoices FOR UPDATE TO authenticated
  USING (is_admin() OR get_my_role() = 'Accounts')
  WITH CHECK (is_admin() OR get_my_role() = 'Accounts');
CREATE POLICY "delete_invoices" ON invoices FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_payments" ON payments FOR SELECT TO authenticated USING (
  is_admin() OR get_my_role() = 'Accounts' OR lead_id IN (
    SELECT id FROM leads WHERE assigned_to = get_my_consultant_id()
  )
);
CREATE POLICY "insert_payments" ON payments FOR INSERT TO authenticated WITH CHECK (
  is_admin() OR get_my_role() = 'Accounts'
);
CREATE POLICY "update_payments" ON payments FOR UPDATE TO authenticated
  USING (is_admin() OR get_my_role() = 'Accounts')
  WITH CHECK (is_admin() OR get_my_role() = 'Accounts');
CREATE POLICY "delete_payments" ON payments FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- RLS POLICIES — AI AGENTS & JOBS (readable by all, writable by admin)
-- ============================================================
CREATE POLICY "select_ai_agents" ON ai_agents FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_ai_agents" ON ai_agents FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_ai_agents" ON ai_agents FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_ai_agents" ON ai_agents FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_ai_jobs" ON ai_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_ai_jobs" ON ai_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_ai_jobs" ON ai_jobs FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_ai_jobs" ON ai_jobs FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_ai_outcomes" ON ai_outcomes FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_ai_outcomes" ON ai_outcomes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_ai_outcomes" ON ai_outcomes FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_ai_outcomes" ON ai_outcomes FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_ai_evolution" ON ai_evolution FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "insert_ai_evolution" ON ai_evolution FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_ai_evolution" ON ai_evolution FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_ai_evolution" ON ai_evolution FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- RLS POLICIES — AGENT MEMORY, WORKFLOWS, OBJECTIVES, ACTIVITY LOG, CONVERSATIONS
-- ============================================================
CREATE POLICY "select_agent_memory" ON agent_memory FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "insert_agent_memory" ON agent_memory FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_agent_memory" ON agent_memory FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_agent_memory" ON agent_memory FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_agent_workflows" ON agent_workflows FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_agent_workflows" ON agent_workflows FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_agent_workflows" ON agent_workflows FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_agent_workflows" ON agent_workflows FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_agent_objectives" ON agent_objectives FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_agent_objectives" ON agent_objectives FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_agent_objectives" ON agent_objectives FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_agent_objectives" ON agent_objectives FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_agent_activity" ON agent_activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_agent_activity" ON agent_activity_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "select_own_conversations" ON agent_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_conversations" ON agent_conversations FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- RLS POLICIES — SETTINGS (admin only)
-- ============================================================
CREATE POLICY "select_settings" ON settings FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "insert_settings" ON settings FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_settings" ON settings FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_settings" ON settings FOR DELETE TO authenticated USING (is_admin());
