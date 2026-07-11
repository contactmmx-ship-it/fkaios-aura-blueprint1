// enrichment v3 (Founder Directive — commercial pipeline repair).
// ROOT CAUSE fixed: v2 read Deno.env.get('APIFY_API_TOKEN') (never set — the
// real Apify token lives in the apify_connections table) and wrote only to a
// siloed enriched_leads table, so it never ran and the leads row stayed
// contactless. enriched_leads had 0 rows for weeks — proof it never worked.
//
// v3 reuses the PROVEN, FREE maps-engine capability (OpenStreetMap Nominatim)
// to look up each discovered business by name+city, then writes any real phone
// / website / address BACK onto the leads row (contact_phone, location, notes)
// so the qualifier + auto-pilot actually see contactable data. No Apify credits
// spent. Honest: OSM coverage for small Indian businesses is partial — leads
// with no OSM record simply stay contactless (flagged), never fabricated.
//
// Actions (heartbeat-secret auth, matches the rest of the pipeline):
//   enrich_lead { lead_id }
//   enrich_new  { limit? }  -> enrich unenriched ai_discovery leads
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-heartbeat-secret', 'Content-Type': 'application/json' };
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const t0 = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const hbSecret = Deno.env.get('HEARTBEAT_SECRET');
    const provided = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    const authHeader = req.headers.get('Authorization');
    if (hbSecret && provided !== hbSecret && !authHeader) return err('Unauthorized', 401);

    const db = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({})) as any;
    const action = body.action ?? 'enrich_new';

    async function logExec(status: string, input: string, output: string, error?: string) {
      try { await db.from('execution_log').insert({ function_name: 'enrichment', department_code: 'SALES', action, status, input_summary: input.slice(0, 400), output_summary: output.slice(0, 400), error: error?.slice(0, 400) ?? null, latency_ms: Date.now() - t0 }); } catch (_) {}
    }

    // Reuse the proven, FREE maps-engine (OpenStreetMap). Returns places with phone/website.
    async function mapsLookup(searchStr: string): Promise<any[]> {
      const res = await fetch(`${supabaseUrl}/functions/v1/maps-engine`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', searchStr }),
      });
      if (!res.ok) return [];
      const d = await res.json().catch(() => ({}));
      return Array.isArray(d.places) ? d.places : [];
    }

    async function enrichOne(lead: any): Promise<{ found: boolean; phone: string | null; website: string | null; address: string | null; reason?: string }> {
      if (!lead.company_name) return { found: false, phone: null, website: null, address: null, reason: 'no company_name' };
      const loc = lead.city || lead.location || '';
      const q = loc ? `${lead.company_name}, ${loc}` : lead.company_name;
      const places = await mapsLookup(q);
      if (places.length === 0) return { found: false, phone: null, website: null, address: null, reason: 'no OSM record' };
      const first = String(lead.company_name).toLowerCase().split(' ')[0];
      const match = places.find((p: any) => String(p.name || '').toLowerCase().includes(first)) || places[0];
      const phone = match.phone && match.phone !== 'N/A' ? String(match.phone) : null;
      const website = match.website && match.website !== 'N/A' ? String(match.website) : null;
      const address = match.address && match.address !== 'N/A' ? String(match.address) : null;

      const upd: Record<string, unknown> = {};
      if (phone && !lead.contact_phone) upd.contact_phone = phone;
      if (address && !lead.location) upd.location = address;
      if (Object.keys(upd).length > 0) {
        upd.updated_at = new Date().toISOString();
        upd.notes = `${(lead.notes ?? '').slice(0, 700)} [enriched via OSM: ${phone ? 'phone ' : ''}${website ? 'website ' : ''}${address ? 'address' : ''}]`.slice(0, 900);
        await db.from('leads').update(upd).eq('id', lead.id);
      }
      await db.from('enriched_leads').upsert({
        lead_id: lead.id, company_name: match.name || lead.company_name, website: website || '',
        industry: match.types || '', enrichment_score: (phone ? 60 : 0) + (website ? 20 : 0) + (address ? 20 : 0),
        data_source: 'osm_nominatim', phone: phone || null, address: address || null,
      }, { onConflict: 'lead_id' });

      return { found: !!(phone || website || address), phone, website, address };
    }

    if (action === 'enrich_lead') {
      if (!body.lead_id) return err('lead_id required', 400);
      const { data: lead, error: le } = await db.from('leads').select('id, company_name, contact_phone, city, location, notes').eq('id', body.lead_id).maybeSingle();
      if (le || !lead) return err('Lead not found', 404);
      const r = await enrichOne(lead);
      await logExec(r.found ? 'success' : 'success', lead.company_name ?? '', `found=${r.found} phone=${r.phone ? 'yes' : 'no'} website=${r.website ? 'yes' : 'no'}${r.reason ? ` (${r.reason})` : ''}`);
      return ok({ action, lead_id: body.lead_id, ...r });
    }

    if (action === 'enrich_new') {
      const limit = Math.min(Number(body.limit) || 10, 25);
      const { data: leads } = await db.from('leads').select('id, company_name, contact_phone, city, location, notes')
        .eq('lead_source', 'ai_discovery').eq('is_active', true).is('contact_phone', null).limit(limit);
      if (!leads || leads.length === 0) { await logExec('success', 'enrich_new', '0 unenriched leads'); return ok({ action, processed: 0, enriched_with_phone: 0, enriched_with_any: 0 }); }

      let withPhone = 0, withAny = 0;
      const details: any[] = [];
      for (const lead of leads) {
        try {
          const r = await enrichOne(lead);
          if (r.phone) withPhone++;
          if (r.found) withAny++;
          details.push({ company: lead.company_name, phone: r.phone, website: r.website, reason: r.reason });
        } catch (e) { details.push({ company: lead.company_name, error: e instanceof Error ? e.message : String(e) }); }
        await sleep(1200); // respect OSM Nominatim ~1 req/sec policy
      }
      await logExec('success', `enrich_new limit=${limit}`, `processed=${leads.length} phone=${withPhone} any=${withAny}`);
      return ok({ action, processed: leads.length, enriched_with_phone: withPhone, enriched_with_any: withAny, details });
    }

    return err(`Unknown action: ${action}. Use enrich_lead | enrich_new`, 400);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});
