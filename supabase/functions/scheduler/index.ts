// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v23 pulled 2026-07-05):
// Real function — honest failure path when APIFY_API_TOKEN is unset
// (marks job FAILED and returns success:false rather than faking a
// run). Minor flag: `run_count: job.run_count + 1` is a read-then-write
// increment with no locking — concurrent run_now calls on the same job
// could race and undercount. Not fixed here.
// ═══════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, ...payload } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const APIFY_TOKEN = Deno.env.get('APIFY_API_TOKEN');

    if (action === 'list') {
      const { data, error } = await supabase.from('apify_scheduled_jobs').select('*').order('name');
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'run_now') {
      const { job_id } = payload;
      const { data: job, error: jobErr } = await supabase.from('apify_scheduled_jobs').select('*').eq('id', job_id).single();
      if (jobErr || !job) throw new Error('Job not found');
      if (!job.is_active) throw new Error('Job is not active');

      if (APIFY_TOKEN) {
        const resp = await fetch(`https://api.apify.com/v2/acts/${job.actor_id}/runs`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(job.config || {}),
        });
        if (!resp.ok) throw new Error(`Apify run failed: ${resp.status}`);
        const run = await resp.json();
        await supabase.from('apify_scheduled_jobs').update({
          last_run_at: new Date().toISOString(),
          last_run_status: 'RUNNING',
          run_count: job.run_count + 1,
        }).eq('id', job_id);
        return new Response(JSON.stringify({ success: true, message: `Run started: ${run.data?.id}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } else {
        await supabase.from('apify_scheduled_jobs').update({
          last_run_at: new Date().toISOString(),
          last_run_status: 'FAILED',
          run_count: job.run_count + 1,
        }).eq('id', job_id);
        return new Response(JSON.stringify({ success: false, error: 'APIFY_API_TOKEN not set' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (action === 'toggle') {
      const { job_id, is_active } = payload;
      const { error } = await supabase.from('apify_scheduled_jobs').update({ is_active }).eq('id', job_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: `Unknown action: ${action}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
