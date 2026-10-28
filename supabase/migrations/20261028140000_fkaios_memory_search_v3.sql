-- ONE BRAIN: founder-memory search v3 (28 Oct 2026). Applied live 28 Oct 2026 in these pieces.
-- Problem seen live: v2 scored a page only by the share of query words it contains, so long unrelated chats
-- ("What is Apify AI") tied with the real Chaat Masters chats and the pages holding the franchise figures
-- never reached the top 5. v3:
--   * weights each word by rarity (a brand name counts more than "plan" or "model");
--   * the rarest word (if it is on <=10% of pages) is an ANCHOR: every result must contain it;
--   * bonus for anchor density, anchor in the chat title, and pages full of figures (Rs, %, lakh, 1,00,000);
--   * pages with figures are returned in full (3,200 chars) so numbers reach the writer and the verifier;
--   * at least 8 chats are returned (one best page per chat).
-- Same signature and columns as v2, so vault-engine and memory-search need no change.
-- Side table fkaios_page_terms (precomputed words + figure count per page) keeps it at ~3-4 s instead of 13-22 s.
-- Rollback: make fkaios_memory_search call fkaios_memory_search_v2 (kept).

create table if not exists public.fkaios_page_terms (
  page_id uuid primary key references public.fkaios_knowledge_pages(id) on delete cascade,
  v tsvector not null,
  figs integer not null default 0
);
alter table public.fkaios_page_terms enable row level security;
create index if not exists fkaios_page_terms_v on public.fkaios_page_terms using gin (v);

create or replace function public.fkaios_index_pages(p_batch int default 2000) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  insert into fkaios_page_terms(page_id, v, figs)
  select p.id,
    to_tsvector('english', translate(coalesce(s.title,'') || ' ' || coalesce(p.text, ''), '/_\', '   ')),
    (length(coalesce(p.text,'')) - length(replace(coalesce(p.text,''), chr(8377), '')))
      + regexp_count(coalesce(p.text,''), '[0-9]+(\.[0-9]+)? ?%|[0-9]{1,2},[0-9]{2},[0-9]{3}|[0-9]+ ?(lakh|lac|crore|cr)\M', 1, 'i')
  from fkaios_knowledge_pages p join fkaios_knowledge_sources s on s.id = p.source_id
  where not exists (select 1 from fkaios_page_terms t where t.page_id = p.id)
  limit p_batch
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
-- Backfill: run select public.fkaios_index_pages(4000); until it returns 0.

create or replace function public.fkaios_page_terms_sync() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into fkaios_page_terms(page_id, v, figs)
  select new.id,
    to_tsvector('english', translate(coalesce(s.title,'') || ' ' || coalesce(new.text, ''), '/_\', '   ')),
    (length(coalesce(new.text,'')) - length(replace(coalesce(new.text,''), chr(8377), '')))
      + regexp_count(coalesce(new.text,''), '[0-9]+(\.[0-9]+)? ?%|[0-9]{1,2},[0-9]{2},[0-9]{3}|[0-9]+ ?(lakh|lac|crore|cr)\M', 1, 'i')
  from fkaios_knowledge_sources s where s.id = new.source_id
  on conflict (page_id) do update set v = excluded.v, figs = excluded.figs;
  return new;
end $$;
drop trigger if exists fkaios_page_terms_sync on public.fkaios_knowledge_pages;
create trigger fkaios_page_terms_sync after insert or update of text on public.fkaios_knowledge_pages
  for each row execute function public.fkaios_page_terms_sync();

create or replace function public.fkaios_memory_search_v3(p_terms text[], p_limit integer default 5)
returns table(source_id uuid, title text, pdf_page integer, matched_fraction real, excerpt text)
language plpgsql stable security definer set search_path to 'public' as $f$
declare n_pages int; tw jsonb; wsum real; anchor text; qo tsquery; qanc tsquery;
begin
  select count(*) into n_pages from fkaios_page_terms;
  if n_pages = 0 then return; end if;
  select jsonb_object_agg(term, w), sum(w) into tw, wsum from (
    select term, (ln((n_pages + 1)::real / (df + 1)) + 0.1)::real as w from (
      select u.t as term, (select count(*) from fkaios_page_terms pt where pt.v @@ to_tsquery('english', quote_literal(u.t) || ':*'))::int as df
      from (select distinct lower(t) t from unnest(p_terms) t where length(t) > 1) u
    ) d where df > 0
  ) x;
  if tw is null then return; end if;
  select e.key into anchor from jsonb_each_text(tw) e order by e.value::real desc limit 1;
  if (tw->>anchor)::real < ln((n_pages + 1)::real / greatest(50, n_pages * 0.10)) then anchor := null; end if;
  qo := to_tsquery('english', array_to_string(array(select quote_literal(k) || ':*' from jsonb_object_keys(tw) k), ' | '));
  if anchor is not null then qanc := to_tsquery('english', quote_literal(anchor) || ':*'); end if;

  return query
  with cand as (
    select pt.page_id, pt.v, pt.figs from fkaios_page_terms pt
    where pt.v @@ coalesce(qanc, qo)
    order by ts_rank_cd(pt.v, qo) desc limit 1200
  ), scored as (
    select c.page_id, c.figs,
      ((select coalesce(sum(e.value::real), 0) from jsonb_each_text(tw) e
          where c.v @@ to_tsquery('english', quote_literal(e.key) || ':*')) / wsum)::real as wcov
    from cand c
  ), joined as (
    select p.source_id, p.pdf_page, p.text, s.title as stitle, sc.figs, sc.wcov,
      (case when anchor is not null and s.title ilike '%' || anchor || '%' then 1 else 0 end)::real as tanc,
      (case when anchor is null then 0
            else (length(p.text) - length(replace(lower(p.text), anchor, ''))) / length(anchor) end)::real as amen
    from scored sc join fkaios_knowledge_pages p on p.id = sc.page_id join fkaios_knowledge_sources s on s.id = p.source_id
    where s.title not like 'ChatGPT chats index%'
  ), ranked as (
    select j.*, (j.wcov + 0.25 * least(1, ln(1 + j.amen) / ln(25)) + 0.2 * j.tanc + 0.2 * least(1, coalesce(j.figs, 0) / 12.0))::real as sc
    from joined j
  ), best as (
    select distinct on (ranked.source_id) * from ranked order by ranked.source_id, sc desc
  )
  select b.source_id, b.stitle, b.pdf_page, b.wcov,
         case when coalesce(b.figs, 0) >= 3 then left(b.text, 3200)
              else ts_headline('english', b.text, qo, 'MaxFragments=6, MaxWords=70, MinWords=30, StartSel=[, StopSel=]') end
  from best b order by b.sc desc limit least(greatest(p_limit, 8), 12);
end $f$;

-- Keep v2 as fkaios_memory_search_v2 (copied live from the v2 definition in 20261028130000), then point the main name at v3.
create or replace function public.fkaios_memory_search(p_terms text[], p_limit integer default 5)
returns table(source_id uuid, title text, pdf_page integer, matched_fraction real, excerpt text)
language sql stable security definer set search_path to 'public' as $$
  select * from public.fkaios_memory_search_v3(p_terms, p_limit);
$$;
