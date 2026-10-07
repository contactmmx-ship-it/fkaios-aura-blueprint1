-- Applied in production as version 20260709035341 (add_travel_booking_workflow).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 252fbce61daa72492849f0cfb4ddf5f1).
-- Record only: do not apply from this folder.

-- Real founder travel-booking workflow: search-and-negotiate-via-vendor-contact,
-- with a MANDATORY double-approval gate before anything is sent to a vendor
-- and before any payment/document is transmitted. No fare data is ever
-- fabricated by the system — fare_options must come from either a real
-- integrated search source or the founder's own manual input.
create table if not exists travel_booking_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  founder_request text not null,
  origin text,
  destination text,
  travel_date date,
  return_date date,
  passengers integer default 1,
  status text not null default 'requested' check (status in (
    'requested',              -- founder asked to book something
    'awaiting_fare_source',   -- system has no live fare search wired; needs founder input or vendor contact
    'options_presented',      -- real fare options shown to founder
    'option_approved',        -- founder picked one (approval #1)
    'vendor_contacted',       -- WhatsApp/message sent to vendor asking to book
    'vendor_demand_received', -- vendor replied with what they need (payment, docs, ID etc.)
    'awaiting_double_approval', -- vendor's demand shown to founder, needs explicit 2nd approval
    'double_approved',        -- founder approved sending payment/documents
    'sent_to_vendor',         -- payment/documents relayed to vendor
    'ticket_received',        -- vendor sent back the ticket
    'completed',
    'cancelled'
  )),
  fare_options jsonb,            -- [{airline, price, source, link, notes}], only ever real data
  selected_option jsonb,
  vendor_name text,
  vendor_contact_whatsapp text,
  vendor_demand_text text,       -- what the vendor is asking for, verbatim
  vendor_demand_document_url text,
  founder_approval_1_at timestamptz,  -- approved which option to pursue
  founder_approval_1_by uuid,
  founder_approval_2_at timestamptz,  -- approved sending payment/docs to vendor
  founder_approval_2_by uuid,
  payment_or_document_sent_url text,
  ticket_document_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table travel_booking_requests enable row level security;
create policy "founder full access to travel bookings" on travel_booking_requests
  for all using (auth.uid() in (select user_id from rbac_user_roles ur join rbac_roles r on r.id = ur.role_id where r.name = 'founder'));
create index if not exists idx_travel_status on travel_booking_requests(status, created_at desc);
