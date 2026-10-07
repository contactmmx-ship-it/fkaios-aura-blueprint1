-- Applied in production as version 20260708110112 (product_video_generator_fix).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: b4be6606ba9f38013c3008c509807350).
-- Record only: do not apply from this folder.

insert into storage.buckets (id, name, public) values ('product-video-photos', 'product-video-photos', true)
on conflict (id) do nothing;

create table if not exists product_video_requests (
  id uuid primary key default gen_random_uuid(),
  client_name text not null default 'Dental Kart',
  product_name text not null,
  category text,
  brand text,
  key_feature_1 text,
  key_feature_2 text,
  key_feature_3 text,
  price text,
  photo_paths text[] not null default '{}',
  video_template text default 'standard' check (video_template in ('standard','premium','reels')),
  status text default 'submitted' check (status in ('submitted','pending_3d_generation','generating_3d','generating_video','ready','failed','blocked_no_api_key')),
  model_3d_url text,
  video_url_16_9 text,
  video_url_9_16 text,
  video_url_1_1 text,
  error_message text,
  submitted_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table product_video_requests enable row level security;
create policy "authenticated full access" on product_video_requests for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "product video photos storage access" on storage.objects for all
  using (bucket_id = 'product-video-photos' and auth.role() = 'authenticated')
  with check (bucket_id = 'product-video-photos' and auth.role() = 'authenticated');
