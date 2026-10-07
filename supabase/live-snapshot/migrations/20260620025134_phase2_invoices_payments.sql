-- Applied in production as version 20260620025134 (phase2_invoices_payments).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 1d2a9904d69ca3324e1f4eb73df1083f).
-- Record only: do not apply from this folder.


-- Phase 2 Migration: Enhanced invoices and payments with Razorpay tracking

-- Add invoice_template column to invoices (for customization per brand)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_template jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS razorpay_order_id text UNIQUE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS generated_by uuid REFERENCES ai_agents(id);

-- Add payment gateway tracking
ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_payment_id text UNIQUE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_signature text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_gateway text DEFAULT 'razorpay';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_link text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS webhook_verified boolean DEFAULT false;

-- Create invoice_items table (line items for invoices)
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  description text,
  quantity integer DEFAULT 1,
  unit_price numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL,
  item_type text CHECK (item_type IN ('franchise_fee', 'training', 'inventory', 'tech_setup', 'other')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

-- Create payment_webhooks table (log all Razorpay webhook events)
CREATE TABLE IF NOT EXISTS payment_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text UNIQUE,
  event_type text,
  payment_id text REFERENCES payments(razorpay_payment_id),
  payload jsonb,
  processed boolean DEFAULT false,
  processed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payment_webhooks ENABLE ROW LEVEL SECURITY;

-- Add RLS policies for new tables
CREATE POLICY "select_invoice_items" ON invoice_items FOR SELECT TO authenticated USING (
  is_admin() OR invoice_id IN (
    SELECT id FROM invoices WHERE lead_id IN (
      SELECT id FROM leads WHERE assigned_to = get_my_consultant_id() OR brand_id = ANY(my_brand_ids())
    )
  )
);

CREATE POLICY "insert_invoice_items" ON invoice_items FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "update_invoice_items" ON invoice_items FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "delete_invoice_items" ON invoice_items FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "select_payment_webhooks" ON payment_webhooks FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "insert_payment_webhooks" ON payment_webhooks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_payment_webhooks" ON payment_webhooks FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Indexes for payment tracking
CREATE INDEX IF NOT EXISTS idx_invoices_razorpay_order ON invoices(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_id ON payments(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_event ON payment_webhooks(event_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_processed ON payment_webhooks(processed);
