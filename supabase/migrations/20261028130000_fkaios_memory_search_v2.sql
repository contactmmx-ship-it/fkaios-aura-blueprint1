-- 28 Oct 2026 (already applied live): wider memory excerpts; project chips show names.
create or replace function public.fkaios_memory_search(p_terms text[], p_limit integer default 5)
returns table (source_id uuid, title text, pdf_page integer, matched_fraction real, excerpt text)
language plpgsql stable security definer set search_path = public as $f$
declare qo tsquery; qa tsquery; n int;
begin
  n := coalesce(array_length(p_terms,1),0);
  if n = 0 then return; end if;
  qo := to_tsquery('english', array_to_string(array(select quote_literal(t)||':*' from unnest(p_terms) t where t <> ''), ' | '));
  qa := to_tsquery('english', array_to_string(array(select quote_literal(t)||':*' from unnest(p_terms) t where t <> ''), ' & '));
  return query
  with ids as (
    (select p.id from fkaios_knowledge_pages p where to_tsvector('english', translate(coalesce(p.text,''), '/_\', '   ')) @@ qa limit 200)
    union
    (select p.id from fkaios_knowledge_pages p join fkaios_knowledge_sources s on s.id = p.source_id
      where s.title ilike any (array(select '%'||t||'%' from unnest(p_terms) t where length(t) > 3)) limit 400)
    union
    (select p.id from fkaios_knowledge_pages p where to_tsvector('english', translate(coalesce(p.text,''), '/_\', '   ')) @@ qo limit 300)
  ), cand as (
    select p.source_id, p.pdf_page, p.text, s.title as stitle,
           to_tsvector('english', translate(coalesce(s.title,'')||' '||coalesce(p.text,''), '/_\', '   ')) as v
    from ids join fkaios_knowledge_pages p on p.id = ids.id join fkaios_knowledge_sources s on s.id = p.source_id
    where s.title not like 'ChatGPT chats index%'
  ), scored as (
    select c.*, ((select count(*) from unnest(p_terms) t where c.v @@ to_tsquery('english', quote_literal(t)||':*'))::real / n)::real as frac,
           ts_rank_cd(c.v, qo) as r
    from cand c
  ), best as (
    select distinct on (scored.source_id) * from scored order by scored.source_id, frac desc, r desc
  )
  select b.source_id, b.stitle, b.pdf_page, b.frac,
         ts_headline('english', b.text, qo, 'MaxFragments=6, MaxWords=70, MinWords=30, StartSel=[, StopSel=]')
  from best b order by b.frac desc, b.r desc limit greatest(1, least(p_limit, 10));
end $f$;
revoke all on function public.fkaios_memory_search(text[], integer) from public, anon, authenticated;

create or replace function public.fkaios_memory_projects()
returns table (project text, chats bigint, pages bigint)
language sql stable security definer set search_path = public as $f$
  with names as (
    select distinct on (m[1]) m[1] as code, trim(m[2]) as name
    from fkaios_knowledge_pages p join fkaios_knowledge_sources s on s.id = p.source_id,
         regexp_matches(p.text, '(P\d\d) ([^|\n]+?) \|', 'g') m
    where s.title like 'ChatGPT chats index%'
  )
  select coalesce(s.project_ref,'other') || coalesce(' ' || n.name, ''), count(*), sum(s.page_count)::bigint
  from fkaios_knowledge_sources s left join names n on n.code = s.project_ref
  where s.title not like 'ChatGPT chats index%'
  group by 1 order by 2 desc;
$f$;
revoke all on function public.fkaios_memory_projects() from public, anon, authenticated;
