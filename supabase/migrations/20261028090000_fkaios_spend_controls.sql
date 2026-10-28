-- Founder spend switches (28 Oct 2026). Automatic paid research stays OFF until the founder enables it.
create table if not exists public.fkaios_spend_controls(
  key text primary key,
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.fkaios_spend_controls enable row level security;
revoke all on public.fkaios_spend_controls from anon;
grant select on public.fkaios_spend_controls to authenticated;
drop policy if exists fkaios_spend_controls_read on public.fkaios_spend_controls;
create policy fkaios_spend_controls_read on public.fkaios_spend_controls for select to authenticated using (true);
insert into public.fkaios_spend_controls(key, enabled, note)
values ('paid_research_auto', false, 'Automatic Apify web research by agents/objectives/schedules. Founder-started searches are not affected.')
on conflict (key) do nothing;
