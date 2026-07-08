// product-video-engine v1 — Dental Kart 2D-photo -> 3D product video app.
// Real submission + storage today. 3D generation (Meshy.ai) and video
// rendering only run once MESHY_API_KEY is actually configured — until
// then, submissions land honestly at status='blocked_no_api_key', never
// silently faked as processing.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID' };
function cid(): string { return crypto.randomUUID().slice(0, 8); }
function errRes(m: string, s: number, id?: string): Response { return new Response(JSON.stringify({ error: m, correlationId: id }), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function okRes(d: unknown, id?: string): Response { return new Response(JSON.stringify({ ...(d as Record<string, unknown>), correlationId: id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
async function verifyJWT(authHeader: string | null, supabaseUrl: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  const db = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: authHeader ? { Authorization: authHeader } : {} } });

  try {
    const user = await verifyJWT(authHeader, supabaseUrl);
    if (!user) return errRes('Unauthorized', 401, id);
    if (req.method !== 'POST') return errRes('Method not allowed', 405, id);

    const body = await req.json() as {
      action?: string; client_name?: string; product_name?: string; category?: string; brand?: string;
      key_feature_1?: string; key_feature_2?: string; key_feature_3?: string; price?: string;
      photo_paths?: string[]; video_template?: string; request_id?: string;
    };

    if (body.action === 'submit_request') {
      const { product_name, photo_paths } = body;
      if (!product_name) return errRes('product_name is required', 400, id);
      if (!photo_paths || photo_paths.length === 0) return errRes('At least one photo is required', 400, id);

      const meshyKey = Deno.env.get('MESHY_API_KEY');
      const status = meshyKey ? 'pending_3d_generation' : 'blocked_no_api_key';

      const { data: request, error } = await db.from('product_video_requests').insert({
        client_name: body.client_name || 'Dental Kart', product_name, category: body.category ?? null,
        brand: body.brand ?? null, key_feature_1: body.key_feature_1 ?? null, key_feature_2: body.key_feature_2 ?? null,
        key_feature_3: body.key_feature_3 ?? null, price: body.price ?? null, photo_paths,
        video_template: body.video_template ?? 'standard', status, submitted_by: user.userId,
        error_message: meshyKey ? null : 'MESHY_API_KEY not configured — photos are saved, but 3D generation cannot run until this is added.',
      }).select('id').single();
      if (error) throw error;

      return okRes({
        request_id: request.id, status,
        message: meshyKey ? 'Submitted — 3D generation will begin.' : 'Photos and details saved. 3D video generation is NOT running yet — MESHY_API_KEY needs to be added first. Nothing will silently "process" until then.',
      }, id);
    }

    if (body.action === 'generate_3d') {
      const { request_id } = body;
      if (!request_id) return errRes('request_id is required', 400, id);
      const meshyKey = Deno.env.get('MESHY_API_KEY');
      if (!meshyKey) {
        await db.from('product_video_requests').update({ status: 'blocked_no_api_key', error_message: 'MESHY_API_KEY not configured.' }).eq('id', request_id);
        return errRes('MESHY_API_KEY is not configured — cannot generate 3D model. Add the key first.', 500, id);
      }
      const { data: reqRow, error: reqErr } = await db.from('product_video_requests').select('*').eq('id', request_id).single();
      if (reqErr || !reqRow) return errRes('Request not found', 404, id);

      await db.from('product_video_requests').update({ status: 'generating_3d' }).eq('id', request_id);

      const { data: signedUrls } = await db.storage.from('product-video-photos').createSignedUrls(reqRow.photo_paths, 3600);
      const imageUrl = signedUrls?.[0]?.signedUrl;
      if (!imageUrl) {
        await db.from('product_video_requests').update({ status: 'failed', error_message: 'Could not generate a signed URL for the uploaded photo.' }).eq('id', request_id);
        return errRes('Could not access uploaded photo', 500, id);
      }

      try {
        const meshyRes = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
          method: 'POST',
          headers: { Authorization: `Bearer ${meshyKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: imageUrl, enable_pbr: true }),
        });
        if (!meshyRes.ok) {
          const errText = await meshyRes.text();
          await db.from('product_video_requests').update({ status: 'failed', error_message: `Meshy.ai error: ${errText.slice(0, 300)}` }).eq('id', request_id);
          return errRes(`Meshy.ai error: ${errText.slice(0, 300)}`, 502, id);
        }
        const meshyData = await meshyRes.json();
        await db.from('product_video_requests').update({ status: 'generating_3d', model_3d_url: meshyData.result ?? null, error_message: `Meshy.ai task queued (id: ${meshyData.result}). Poll Meshy's task status endpoint to know when the 3D model is ready — this engine does not yet auto-poll.` }).eq('id', request_id);
        return okRes({ request_id, meshy_task_id: meshyData.result, status: 'generating_3d', note: "Meshy.ai task created. Video rendering (Blender/After Effects step from the spec) is NOT implemented in this engine yet — that's a separate, larger build once 3D generation itself is confirmed working end to end." }, id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.from('product_video_requests').update({ status: 'failed', error_message: msg }).eq('id', request_id);
        return errRes(msg, 500, id);
      }
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return errRes(msg, 500, id);
  }
});
