-- Read-only, evidence-backed audit of the actual FKAIOS brand registry and CRM pipeline.
create or replace function public.fkaios_brand_pipeline_audit()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_brands jsonb;
  v_expected jsonb;
  v_counts jsonb;
  v_missing jsonb;
  v_total_leads integer;
  v_branded_leads integer;
  v_unbranded_leads integer;
  v_unassigned integer;
  v_no_followup integer;
  v_activities integer;
  v_lifecycle integer;
  v_ingestion integer;
  v_enriched integer;
  v_brand_count integer;
  v_expected_count integer := 10;
  v_mapped_count integer;
begin
  select count(*) into v_brand_count from public.brands;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status,
    'is_active', b.is_active, 'company_id', b.company_id,
    'lead_count', coalesce(l.lead_count, 0)
  ) order by b.name), '[]'::jsonb)
  into v_brands
  from public.brands b
  left join lateral (
    select count(*)::integer as lead_count from public.leads l where l.brand_id = b.id
  ) l on true;

  with expected(canonical_name, current_name) as (
    values
      ('Franchise Kart', 'Franchisee Kart'),
      ('Mr. Chick''n', 'Mr. Chick''n'),
      ('GoMax', 'GoMax'),
      ('Gio Paints', 'Gio Paints'),
      ('Arofur', 'Arofur'),
      ('Chaat Masters', 'Chaat Masters'),
      ('Chawla Lab', 'Chawla Laboratory'),
      ('Turning Point', 'Turning Points'),
      ('Kids DPS', 'Kids DPS'),
      ('Knead & Bake', 'Knead & Bake')
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'canonical_name', e.canonical_name,
      'matched_current_name', b.name,
      'brand_id', b.id,
      'registry_match', b.id is not null
    ) order by e.canonical_name), '[]'::jsonb),
    count(*) filter (where b.id is not null)::integer,
    coalesce(jsonb_agg(e.canonical_name) filter (where b.id is null), '[]'::jsonb)
  into v_expected, v_mapped_count, v_missing
  from expected e
  left join public.brands b on lower(btrim(b.name)) = lower(btrim(e.current_name));

  select count(*)::integer,
         count(*) filter (where brand_id is not null)::integer,
         count(*) filter (where brand_id is null)::integer,
         count(*) filter (where assigned_to is null)::integer,
         count(*) filter (where next_followup is null)::integer
  into v_total_leads, v_branded_leads, v_unbranded_leads, v_unassigned, v_no_followup
  from public.leads;

  select count(*)::integer into v_activities from public.lead_activities;
  select count(*)::integer into v_lifecycle from public.lead_lifecycle;
  select count(*)::integer into v_ingestion from public.lead_ingestion_log;
  select count(*)::integer into v_enriched from public.enriched_leads;

  v_counts := jsonb_build_object(
    'registered_brands', v_brand_count,
    'expected_brands', v_expected_count,
    'expected_brand_names_matched', v_mapped_count,
    'missing_brand_registry_entries', jsonb_array_length(v_missing),
    'total_leads', v_total_leads,
    'leads_with_brand_id', v_branded_leads,
    'leads_without_brand_id', v_unbranded_leads,
    'unassigned_leads', v_unassigned,
    'leads_without_next_followup', v_no_followup,
    'lead_activities', v_activities,
    'lead_lifecycle_rows', v_lifecycle,
    'lead_ingestion_log_rows', v_ingestion,
    'enriched_leads_rows', v_enriched
  );

  return jsonb_build_object(
    'checked_at', now(),
    'audit_scope_complete', true,
    'scope', 'Live database audit of the FKAIOS brand registry, lead-to-brand bindings, lead assignment/follow-up fields, and ingestion/lifecycle evidence. Does not claim that external CRM credentials, webhooks, or third-party integrations are configured.',
    'brand_pipeline_complete', jsonb_array_length(v_missing) = 0 and v_unbranded_leads = 0 and v_ingestion > 0,
    'counts', v_counts,
    'expected_brand_mapping', v_expected,
    'missing_brand_names', v_missing,
    'brand_registry', v_brands
  );
end;
$function$;

revoke all on function public.fkaios_brand_pipeline_audit() from public;
revoke all on function public.fkaios_brand_pipeline_audit() from anon;
revoke all on function public.fkaios_brand_pipeline_audit() from authenticated;
grant execute on function public.fkaios_brand_pipeline_audit() to service_role;
