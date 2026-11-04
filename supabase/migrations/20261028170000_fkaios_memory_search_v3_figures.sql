-- ONE BRAIN: memory search v3 "figures pass" (applied live 28 Oct 2026, ~22:30 IST).
-- A Chaat Masters objective kept writing "fee figures not found" because its one search never reached the
-- pitch-deck chats that hold the fee table. v3 now also returns up to 3 extra chats whose page is dense with
-- figures and is about the entity asked for (uncommon query words appear >= 2 times), ranked by
-- figures x entity mentions. Pages with figures are returned in full (4,200 chars).
CREATE OR REPLACE FUNCTION public.fkaios_memory_search_v3(p_terms text[], p_limit integer DEFAULT 5)
 RETURNS TABLE(source_id uuid, title text, pdf_page integer, matched_fraction real, excerpt text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n_pages int; tw jsonb; wsum real; anchors text[]; qo tsquery; qanc tsquery;
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
  -- anchors: up to 4 uncommon words (each on <=10% of pages); a page must contain at least one of them
  anchors := array(select e.key from jsonb_each_text(tw) e
                   where e.value::real >= ln((n_pages + 1)::real / greatest(50, n_pages * 0.10))
                   order by e.value::real desc limit 4);
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
    select p.source_id, p.pdf_page, p.text, s.title as stitle, sc.figs, sc.wcov,
      (case when exists (select 1 from unnest(coalesce(anchors, '{}'::text[])) a where s.title ilike '%' || a || '%') then 1 else 0 end)::real as tanc,
      (select coalesce(sum((length(p.text) - length(replace(lower(p.text), a, ''))) / length(a)), 0)
       from unnest(coalesce(anchors, '{}'::text[])) a)::real as amen
    from scored sc join fkaios_knowledge_pages p on p.id = sc.page_id join fkaios_knowledge_sources s on s.id = p.source_id
    where s.title not like 'ChatGPT chats index%'
  ), ranked as (
    select j.*, (j.wcov + 0.25 * least(1, ln(1 + j.amen) / ln(25)) + 0.2 * j.tanc + 0.2 * least(1, coalesce(j.figs, 0) / 12.0))::real as sc
    from joined j
  ), best as (
    select distinct on (ranked.source_id) * from ranked order by ranked.source_id, sc desc
  ), top as (
    select * from best order by sc desc limit least(greatest(p_limit, 8), 12)
  ), figpages as (
    -- "figures pass": up to 3 other chats whose page is dense with figures (Rs, %, lakh) and is about the
    -- entity (uncommon query words appear >= 2 times), even when the question's other words do not match.
    -- Relevance floored at 0.6 (similarity 0.8): the page is about the entity and holds its numbers.
    select distinct on (r.source_id) r.* from ranked r
    where anchors is not null and array_length(anchors, 1) > 0
      and coalesce(r.figs, 0) >= 6
      and r.amen >= 2
      and r.source_id not in (select t.source_id from top t)
    order by r.source_id, (least(r.figs, 30) * ln(1 + r.amen)) desc
  ), figtop as (
    -- figures x how much the page is about the entity
    select * from figpages order by (least(figs, 30) * ln(1 + amen)) desc limit 3
  )
  select b.source_id, b.stitle, b.pdf_page, (case when b.grp = 1 then greatest(b.wcov, 0.6) else b.wcov end)::real,
         case when coalesce(b.figs, 0) >= 3 then left(b.text, 4200)
              else ts_headline('english', b.text, qo, 'MaxFragments=6, MaxWords=70, MinWords=30, StartSel=[, StopSel=]') end
  from (select top.*, 0 as grp from top union all select figtop.*, 1 as grp from figtop) b
  order by b.grp, b.sc desc;
end $function$;
