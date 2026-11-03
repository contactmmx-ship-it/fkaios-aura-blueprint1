-- 3 Nov 2026: fkaios_memory_search v4 — same results as v3, faster.
--
-- Why: GoMax objective 5b312395 was blocked because founder-memory searches hit
-- the 8 s API statement timeout (Postgres log 12:04:28-12:04:57 UTC).
-- Measured on live data:
--   * the planner chose a sequential scan of fkaios_page_terms (TOASTed
--     tsvectors): 7.1 s, versus 0.33 s through the existing GIN index;
--   * page text was lower-cased once per anchor word and three more times in
--     the figures pass.
-- v4 forces the index (function-level enable_seqscan = off) and lower-cases each
-- page once. Ranking logic is unchanged: on 5 test queries v4 returned exactly
-- the same sources, scores and excerpt lengths as v3 (0 differences); cold
-- runs 3.6-6.4 s (v3: 6.0-9.8 s), warm 1.3-2.0 s.
-- Rollback: make fkaios_memory_search call fkaios_memory_search_v3 again.

create or replace function public.fkaios_memory_search_v4(p_terms text[], p_limit integer default 5)
 returns table(source_id uuid, title text, pdf_page integer, matched_fraction real, excerpt text)
 language plpgsql stable security definer
 set search_path to 'public'
 set enable_seqscan to 'off'
as $function$
declare n_pages int; tw jsonb; wsum real; anchors text[]; qo tsquery; qanc tsquery; primary_anchor text;
begin
  select count(*) into n_pages from fkaios_page_terms;
  if n_pages = 0 then return; end if;
  select jsonb_object_agg(term, w), sum(w) into tw, wsum from (
    select term, least(3.5, ln((n_pages + 1)::real / (df + 1)) + 0.1)::real as w from (
      select u.t as term, (select count(*) from fkaios_page_terms pt where pt.v @@ to_tsquery('english', quote_literal(u.t) || ':*'))::int as df
      from (select distinct lower(t) t from unnest(p_terms) t where length(t) > 1) u
    ) d where df > 0
  ) x;
  if tw is null then return; end if;
  -- anchors: the two rarest words that are on <=10% of pages; a page must contain at least one of them
  anchors := array(select e.key from jsonb_each_text(tw) e
                   where e.value::real >= ln((n_pages + 1)::real / greatest(50, n_pages * 0.10))
                   order by e.value::real desc limit 6);
  -- primary anchor (29 Oct 2026): the uncommon word found in the most chat titles = the brand/entity asked about
  primary_anchor := (select a from unnest(coalesce(anchors, '{}'::text[])) a
                     order by (select count(*) from fkaios_knowledge_sources s where s.title ilike '%' || a || '%') desc, (tw->>a)::real desc limit 1);
  qo := to_tsquery('english', array_to_string(array(select quote_literal(k) || ':*' from jsonb_object_keys(tw) k), ' | '));
  if coalesce(array_length(anchors, 1), 0) > 0 then
    qanc := to_tsquery('english', array_to_string(array(select quote_literal(a) || ':*' from unnest(anchors) a), ' | '));
  end if;

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
    -- v4: the page text is lower-cased ONCE per page (v3 did it once per anchor and three more times in figpages)
    select p.source_id, p.pdf_page, p.text, s.title as stitle, sc.figs, sc.wcov,
      (case when exists (select 1 from unnest(coalesce(anchors, '{}'::text[])) a where s.title ilike '%' || a || '%') then 1 else 0 end)::real as tanc,
      (select coalesce(sum((length(l.lt) - length(replace(l.lt, a, ''))) / length(a)), 0)
       from unnest(coalesce(anchors, '{}'::text[])) a)::real as amen,
      (case when primary_anchor is null then 0
            else (length(l.lt) - length(replace(l.lt, primary_anchor, ''))) / length(primary_anchor) end)::int as pmen
    from scored sc join fkaios_knowledge_pages p on p.id = sc.page_id join fkaios_knowledge_sources s on s.id = p.source_id
    cross join lateral (select lower(p.text) as lt) l
    where s.title not like 'ChatGPT chats index%'
  ), ranked as (
    select j.*, (j.wcov + 0.25 * least(1, ln(1 + j.amen) / ln(25)) + 0.2 * j.tanc + 0.2 * least(1, coalesce(j.figs, 0) / 12.0))::real as sc
    from joined j
  ), best as (
    select distinct on (ranked.source_id) * from ranked order by ranked.source_id, sc desc
  ), top as (
    select * from best order by sc desc limit least(greatest(p_limit, 8), 12)
  ), figpages as (
    -- 28 Oct 2026 "figures pass" (unchanged rule; v4 reuses pmen = mentions of the primary anchor)
    select distinct on (r.source_id) r.* from ranked r
    where primary_anchor is not null
      and coalesce(r.figs, 0) >= 6
      and r.pmen >= 2
      and r.source_id not in (select t.source_id from top t)
    order by r.source_id, (least(r.figs, 30) * ln(1 + r.pmen)) desc
  ), figtop as (
    select * from figpages order by (least(figs, 30) * ln(1 + pmen)) desc limit 3
  )
  select b.source_id, b.stitle, b.pdf_page, (case when b.grp = 1 then greatest(b.wcov, 0.6) else b.wcov end)::real,
         case when coalesce(b.figs, 0) >= 3 then left(b.text, 4200)
              else ts_headline('english', b.text, qo, 'MaxFragments=6, MaxWords=70, MinWords=30, StartSel=[, StopSel=]') end
  from (select top.source_id, top.stitle, top.pdf_page, top.wcov, top.figs, top.text, top.sc, 0 as grp from top
        union all select figtop.source_id, figtop.stitle, figtop.pdf_page, figtop.wcov, figtop.figs, figtop.text, figtop.sc, 1 as grp from figtop) b
  order by b.grp, b.sc desc;
end;
$function$;

revoke all on function public.fkaios_memory_search_v4(text[], integer) from public, anon, authenticated;
grant execute on function public.fkaios_memory_search_v4(text[], integer) to service_role;

create or replace function public.fkaios_memory_search(p_terms text[], p_limit integer default 5)
 returns table(source_id uuid, title text, pdf_page integer, matched_fraction real, excerpt text)
 language sql stable security definer
 set search_path to 'public'
as $function$
  -- 3 Nov 2026: v4 (v3 ranking, index forced, text lower-cased once). Rollback: call fkaios_memory_search_v3.
  select * from public.fkaios_memory_search_v4(p_terms, p_limit);
$function$;
