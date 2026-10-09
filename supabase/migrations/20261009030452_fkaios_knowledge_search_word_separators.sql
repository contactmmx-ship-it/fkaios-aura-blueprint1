-- Knowledge search: Postgres' parser reads "consumer/executor", "ai_jobs" and
-- Windows paths as single file tokens, so a search for "executor" or "jobs"
-- missed them. Slashes, underscores and backslashes now separate words in both
-- the searched text and the query (expression index; the stored fts column is unused).
create index if not exists fkaios_knowledge_pages_fts_words on public.fkaios_knowledge_pages
  using gin (to_tsvector('english', translate(coalesce(text, ''), '/_\', '   ')));

create or replace function public.fkaios_search_knowledge(p_query text, p_kind text default null, p_limit integer default 5)
returns table (source_id uuid, title text, source_kind text, provenance text, pdf_page integer, printed_label text, line_start integer, line_end integer, completeness text, rank real, excerpt text)
language sql stable security definer set search_path = public as $f$
  select s.id, s.title, s.source_kind, s.provenance, p.pdf_page, p.printed_label, p.line_start, p.line_end, p.completeness,
         ts_rank_cd(to_tsvector('english', translate(coalesce(p.text, ''), '/_\', '   ')), q) as rank,
         ts_headline('english', translate(p.text, '/_\', '   '), q, 'MaxFragments=2, MaxWords=40, MinWords=15, StartSel=«, StopSel=»') as excerpt
  from public.fkaios_knowledge_pages p
  join public.fkaios_knowledge_sources s on s.id = p.source_id
  cross join lateral websearch_to_tsquery('english', translate(p_query, '/_\', '   ')) q
  where to_tsvector('english', translate(coalesce(p.text, ''), '/_\', '   ')) @@ q and (p_kind is null or s.source_kind = p_kind)
  order by rank desc, s.title, p.pdf_page
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$f$;
revoke all on function public.fkaios_search_knowledge(text, text, integer) from public, anon, authenticated;
