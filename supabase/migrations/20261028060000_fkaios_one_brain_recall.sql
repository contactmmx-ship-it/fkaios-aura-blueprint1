-- ONE BRAIN steps 1-2 (26-28 Oct 2026). Already applied live via SQL; recorded so the repo matches production.
create or replace function public.fkaios_recall(p_terms text[], p_limit integer default 6)
returns table (source_id uuid, title text, pdf_page integer, rank real, excerpt text)
language plpgsql stable security definer set search_path = public as $f$
declare qa tsquery; qo tsquery;
begin
  -- precise (all terms) first, then broad (any term); candidates capped for speed; one best page per source.
  qa := to_tsquery('english', array_to_string(array(select quote_literal(t)||':*' from unnest(p_terms) t where t <> ''), ' & '));
  qo := to_tsquery('english', array_to_string(array(select quote_literal(t)||':*' from unnest(p_terms) t where t <> ''), ' | '));
  return query
  with cand as (
    (select p.id, p.source_id, p.pdf_page, p.text, 2 as tier from fkaios_knowledge_pages p
      where to_tsvector('english', translate(coalesce(p.text,''), '/_\', '   ')) @@ qa limit 300)
    union all
    (select p.id, p.source_id, p.pdf_page, p.text, 1 from fkaios_knowledge_pages p
      where to_tsvector('english', translate(coalesce(p.text,''), '/_\', '   ')) @@ qo limit 300)
  ), ranked as (
    select c.*, s.title as stitle, c.tier + ts_rank_cd(to_tsvector('english', translate(c.text,'/_\','   ')), qo)
           + case when s.title ilike any (array(select '%'||t||'%' from unnest(p_terms) t)) then 1 else 0 end as r
    from cand c join fkaios_knowledge_sources s on s.id = c.source_id
    where s.title not like 'ChatGPT chats index%'
  ), best as (
    select distinct on (ranked.source_id) * from ranked order by ranked.source_id, r desc
  )
  select b.source_id, b.stitle, b.pdf_page, b.r::real,
         ts_headline('english', b.text, qo, 'MaxFragments=2, MaxWords=40, MinWords=15, StartSel=[, StopSel=]')
  from best b order by b.r desc limit greatest(1, least(p_limit, 12));
end $f$;
revoke all on function public.fkaios_recall(text[], integer) from public, anon, authenticated;

create or replace function public.fkaios_memory_projects()
returns table (project text, chats bigint, pages bigint)
language sql stable security definer set search_path = public as $f$
  select coalesce(project_ref,'other'), count(*), sum(page_count)::bigint from fkaios_knowledge_sources group by 1 order by 2 desc;
$f$;
revoke all on function public.fkaios_memory_projects() from public, anon, authenticated;
