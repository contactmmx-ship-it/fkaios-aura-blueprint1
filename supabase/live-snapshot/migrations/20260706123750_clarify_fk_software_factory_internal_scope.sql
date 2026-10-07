-- Applied in production as version 20260706123750 (clarify_fk_software_factory_internal_scope).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 12bc38a43fe729e1359c61ba305ad4bc).
-- Record only: do not apply from this folder.


update departments
set mission = 'Build and maintain internal Franchise Kart tools and franchise-network software — dealer/distribution systems (e.g. GoMax), POS, internal CRM, brand ops tooling. Not for external client engagements; that scope belongs exclusively to Aura Tech.',
    updated_at = now()
where code = 'SOFTWARE_FACTORY';

update departments
set mission = 'World-class experience for Franchise Kart franchisees and investors.',
    updated_at = now()
where code = 'SUPPORT';
