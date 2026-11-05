-- Security fix (approved by founder 5 Nov 2026, "APPROVE SECURITY FIX").
-- Supabase advisor 0028: these SECURITY DEFINER functions (owner postgres, so they
-- bypass RLS) were executable by anon and authenticated through /rest/v1/rpc.
-- Anyone holding the public anon key could read knowledge-page text or trigger indexing.
-- Only the service role (edge functions) uses them; the live search entry point
-- fkaios_memory_search and v4 are already service-role only (20261103130000).
-- No data is changed. Triggers keep working (EXECUTE is not checked when a trigger fires).

revoke all on function public.fkaios_memory_search_v2(text[], integer)      from public, anon, authenticated;
revoke all on function public.fkaios_memory_search_v3(text[], integer)      from public, anon, authenticated;
revoke all on function public.fkaios_memory_search_v3_test(text[], integer) from public, anon, authenticated;
revoke all on function public.fkaios_index_pages(integer)                   from public, anon, authenticated;
revoke all on function public.fkaios_page_terms_sync()                      from public, anon, authenticated;

grant execute on function public.fkaios_memory_search_v2(text[], integer)      to service_role;
grant execute on function public.fkaios_memory_search_v3(text[], integer)      to service_role;
grant execute on function public.fkaios_memory_search_v3_test(text[], integer) to service_role;
grant execute on function public.fkaios_index_pages(integer)                   to service_role;
grant execute on function public.fkaios_page_terms_sync()                      to service_role;
