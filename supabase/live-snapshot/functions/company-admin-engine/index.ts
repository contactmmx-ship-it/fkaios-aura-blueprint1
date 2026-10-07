// ============================================================
// company-admin-engine v1 — CRUD for the multi-company structure
// (Bhavishya Associates holding + Franchise Kart / Aura Tech / Rajyog Infra
// subsidiaries), their bank accounts, and KYC documents (cancelled cheque,
// passbook, etc.). Real Supabase Storage upload for documents — no
// simulated file handling.
//
// Actions:
//   companies:        list | create | update | delete
//   bank_accounts:    list | create | update | delete   (scoped to a company)
//   kyc_documents:    list | upload | delete             (real file upload to
//                     the private 'documents' storage bucket, signed URL for
//                     download)
//   annual_targets:   list | upsert
//   revenue_actuals:  list | upsert   (for MTD/YTD tracking per company)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnon) return err('Missing Supabase env');

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
    const parts = authHeader.slice(7).split('.');
    if (parts.length !== 3) return err('Invalid JWT', 401);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Date.now() / 1000) return err('JWT expired', 401);

    const db = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
    const body = await req.json();
    const { resource, action } = body;

    // ---------------- companies ----------------
    if (resource === 'companies') {
      if (action === 'list') {
        const { data, error } = await db.from('companies').select('*').order('company_type', { ascending: false }).order('created_at');
        if (error) return err(error.message);
        return ok({ companies: data ?? [] });
      }
      if (action === 'create') {
        const { name, legal_name, company_type, parent_company_id, sector, status, description } = body;
        if (!name?.trim()) return err('name is required', 400);
        const { data, error } = await db.from('companies').insert({
          name: name.trim(), legal_name: legal_name || name.trim(),
          company_type: company_type || 'subsidiary', parent_company_id: parent_company_id || null,
          sector: sector || null, status: status || 'active', description: description || null,
        }).select('*').single();
        if (error) return err(error.message);
        return ok({ company: data });
      }
      if (action === 'update') {
        const { id, ...fields } = body;
        if (!id) return err('id is required', 400);
        delete fields.resource; delete fields.action;
        fields.updated_at = new Date().toISOString();
        const { data, error } = await db.from('companies').update(fields).eq('id', id).select('*').single();
        if (error) return err(error.message);
        return ok({ company: data });
      }
      if (action === 'delete') {
        const { id } = body;
        if (!id) return err('id is required', 400);
        const { error } = await db.from('companies').delete().eq('id', id);
        if (error) return err(error.message);
        return ok({ deleted: id });
      }
      return err(`Unknown companies action: ${action}`, 400);
    }

    // ---------------- bank accounts ----------------
    if (resource === 'bank_accounts') {
      if (action === 'list') {
        const { company_id } = body;
        let q = db.from('company_bank_accounts').select('*').order('is_primary', { ascending: false }).order('created_at');
        if (company_id) q = q.eq('company_id', company_id);
        const { data, error } = await q;
        if (error) return err(error.message);
        return ok({ bank_accounts: data ?? [] });
      }
      if (action === 'create') {
        const { company_id, account_holder_name, bank_name, account_number, ifsc_code, branch, account_type, is_primary } = body;
        if (!company_id || !account_holder_name?.trim() || !bank_name?.trim() || !account_number?.trim()) {
          return err('company_id, account_holder_name, bank_name, and account_number are required', 400);
        }
        const { data, error } = await db.from('company_bank_accounts').insert({
          company_id, account_holder_name: account_holder_name.trim(), bank_name: bank_name.trim(),
          account_number: account_number.trim(), ifsc_code: ifsc_code || null, branch: branch || null,
          account_type: account_type || 'current', is_primary: !!is_primary,
        }).select('*').single();
        if (error) return err(error.message);
        return ok({ bank_account: data });
      }
      if (action === 'update') {
        const { id, ...fields } = body;
        if (!id) return err('id is required', 400);
        delete fields.resource; delete fields.action;
        fields.updated_at = new Date().toISOString();
        const { data, error } = await db.from('company_bank_accounts').update(fields).eq('id', id).select('*').single();
        if (error) return err(error.message);
        return ok({ bank_account: data });
      }
      if (action === 'delete') {
        const { id } = body;
        if (!id) return err('id is required', 400);
        const { error } = await db.from('company_bank_accounts').delete().eq('id', id);
        if (error) return err(error.message);
        return ok({ deleted: id });
      }
      return err(`Unknown bank_accounts action: ${action}`, 400);
    }

    // ---------------- KYC documents (real file storage) ----------------
    if (resource === 'kyc_documents') {
      if (action === 'list') {
        const { company_id } = body;
        let q = db.from('company_kyc_documents').select('*').order('uploaded_at', { ascending: false });
        if (company_id) q = q.eq('company_id', company_id);
        const { data, error } = await q;
        if (error) return err(error.message);
        // Attach short-lived signed URLs so the founder can actually view/download
        const withUrls = await Promise.all((data ?? []).map(async (doc: any) => {
          const { data: signed } = await db.storage.from('documents').createSignedUrl(doc.file_path, 3600);
          return { ...doc, signed_url: signed?.signedUrl ?? null };
        }));
        return ok({ kyc_documents: withUrls });
      }
      if (action === 'upload') {
        const { company_id, bank_account_id, document_type, file_name, file_base64, notes } = body;
        if (!company_id || !document_type || !file_name || !file_base64) {
          return err('company_id, document_type, file_name, and file_base64 are required', 400);
        }
        const validTypes = ['cancelled_cheque', 'passbook', 'pan_card', 'gst_certificate', 'incorporation_certificate', 'other'];
        if (!validTypes.includes(document_type)) return err(`document_type must be one of: ${validTypes.join(', ')}`, 400);

        const bytes = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
        const path = `kyc/${company_id}/${Date.now()}_${file_name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: upErr } = await db.storage.from('documents').upload(path, bytes, { upsert: false });
        if (upErr) return err(`Upload failed: ${upErr.message}`);

        const { data, error } = await db.from('company_kyc_documents').insert({
          company_id, bank_account_id: bank_account_id || null, document_type,
          file_path: path, file_name, notes: notes || null,
        }).select('*').single();
        if (error) { await db.storage.from('documents').remove([path]); return err(error.message); }
        return ok({ kyc_document: data });
      }
      if (action === 'delete') {
        const { id } = body;
        if (!id) return err('id is required', 400);
        const { data: doc } = await db.from('company_kyc_documents').select('file_path').eq('id', id).single();
        if (doc?.file_path) await db.storage.from('documents').remove([doc.file_path]);
        const { error } = await db.from('company_kyc_documents').delete().eq('id', id);
        if (error) return err(error.message);
        return ok({ deleted: id });
      }
      return err(`Unknown kyc_documents action: ${action}`, 400);
    }

    // ---------------- annual targets ----------------
    if (resource === 'annual_targets') {
      if (action === 'list') {
        const { company_id } = body;
        let q = db.from('company_annual_targets').select('*, company:companies(name)').order('year');
        if (company_id) q = q.eq('company_id', company_id);
        const { data, error } = await q;
        if (error) return err(error.message);
        return ok({ annual_targets: data ?? [] });
      }
      if (action === 'upsert') {
        const { company_id, year, revenue_target_inr, notes } = body;
        if (!company_id || !year) return err('company_id and year are required', 400);
        const { data, error } = await db.from('company_annual_targets')
          .upsert({ company_id, year, revenue_target_inr: revenue_target_inr ?? null, notes: notes ?? null, updated_at: new Date().toISOString() }, { onConflict: 'company_id,year' })
          .select('*').single();
        if (error) return err(error.message);
        return ok({ annual_target: data });
      }
      return err(`Unknown annual_targets action: ${action}`, 400);
    }

    // ---------------- revenue actuals (MTD/YTD) ----------------
    if (resource === 'revenue_actuals') {
      if (action === 'list') {
        const { company_id, year } = body;
        let q = db.from('company_revenue_actuals').select('*').order('year').order('month');
        if (company_id) q = q.eq('company_id', company_id);
        if (year) q = q.eq('year', year);
        const { data, error } = await q;
        if (error) return err(error.message);
        return ok({ revenue_actuals: data ?? [] });
      }
      if (action === 'upsert') {
        const { company_id, year, month, revenue_inr, source } = body;
        if (!company_id || !year || !month) return err('company_id, year, and month are required', 400);
        const { data, error } = await db.from('company_revenue_actuals')
          .upsert({ company_id, year, month, revenue_inr: revenue_inr ?? 0, source: source || 'manual' }, { onConflict: 'company_id,year,month' })
          .select('*').single();
        if (error) return err(error.message);
        return ok({ revenue_actual: data });
      }
      return err(`Unknown revenue_actuals action: ${action}`, 400);
    }

    return err(`Unknown resource: ${resource}. Use companies | bank_accounts | kyc_documents | annual_targets | revenue_actuals`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('COMPANY-ADMIN-ENGINE ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
