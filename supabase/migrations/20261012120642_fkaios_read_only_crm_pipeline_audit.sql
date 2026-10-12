-- Read-only CRM pipeline evidence; no lead or brand records are mutated.
create or replace function public.fkaios_crm_pipeline_audit()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_brand_checks jsonb;
  v_lead_pipeline_checks jsonb;
begin
  select jsonb_build_object(
    'scanned_at', now(),
    'method', 'aggregate scan of public.brands',
    'total_brands', count(*),
    'active_brands', count(*) filter (where coalesce(is_active,false)),
    'brand_names', coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug,'status',status,'is_active',is_active) order by name), '[]'::jsonb)
  )
  into v_brand_checks from public.brands;

  select jsonb_build_object(
    'scanned_at', now(),
    'method', 'aggregate scan of public.leads joined to public.brands',
    'total_leads', count(l.id),
    'active_leads', count(l.id) filter (where coalesce(l.is_active,false)),
    'missing_brand_id_count', count(l.id) filter (where l.brand_id is null),
    'unknown_brand_id_count', count(l.id) filter (where l.brand_id is not null and b.id is null),
    'mapped_leads_count', count(l.id) filter (where b.id is not null),
    'stage_distribution', coalesce((select jsonb_agg(jsonb_build_object('stage',s.stage,'count',s.count) order by s.count desc) from (select stage,count(*)::integer as count from public.leads group by stage) s), '[]'::jsonb),
    'leads_by_brand', coalesce((select jsonb_agg(jsonb_build_object('brand_id',x.brand_id,'brand_name',x.brand_name,'lead_count',x.lead_count) order by x.brand_name) from (select b2.id as brand_id,b2.name as brand_name,count(l2.id)::integer as lead_count from public.brands b2 left join public.leads l2 on l2.brand_id=b2.id group by b2.id,b2.name) x), '[]'::jsonb)
  )
  into v_lead_pipeline_checks
  from public.leads l left join public.brands b on b.id=l.brand_id;

  return jsonb_build_object(
    'checked_at', now(),
    'audit_scope_complete', true,
    'scope', 'Database CRM mapping only: public brand inventory, public lead records, brand_id coverage, stage distribution, and lead counts by brand. Does not mutate business records, verify external CRM synchronization, or crawl every UI route.',
    'brand_checks', jsonb_build_array(v_brand_checks),
    'lead_pipeline_checks', jsonb_build_array(v_lead_pipeline_checks)
  );
end;
$function$;

revoke all on function public.fkaios_crm_pipeline_audit() from public;
revoke all on function public.fkaios_crm_pipeline_audit() from anon;
revoke all on function public.fkaios_crm_pipeline_audit() from authenticated;
grant execute on function public.fkaios_crm_pipeline_audit() to service_role;
