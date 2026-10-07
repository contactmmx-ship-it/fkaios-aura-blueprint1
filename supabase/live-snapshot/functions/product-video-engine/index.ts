// product-video-engine v3 — Tripo3D integration (real free API tier, unlike
// Meshy which requires a paid plan for API access), plus HEARTBEAT_SECRET
// auth path so this can be triggered directly (cron, admin script, or me
// debugging live) not only from a logged-in user's session.
//
// Real Tripo flow, verified against their actual docs: upload the image
// bytes to /upload for a file_token, then submit an image_to_model task
// referencing that token — NOT a direct image_url like Meshy used.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID, x-heartbeat-secret' };
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

function extToTripoType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? 'jpg';
  if (ext === 'jpeg') return 'jpg';
  if (['jpg', 'png', 'webp'].includes(ext)) return ext;
  return 'jpg';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const id = cid();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');

  const heartbeatSecret = Deno.env.get('HEARTBEAT_SECRET');
  const providedSecret = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
  const secretOk = !!heartbeatSecret && providedSecret === heartbeatSecret;

  const db = createClient(supabaseUrl, secretOk && supabaseServiceKey ? supabaseServiceKey : supabaseAnonKey, { global: { headers: authHeader && !secretOk ? { Authorization: authHeader } : {} } });

  try {
    const user = secretOk ? { userId: 'heartbeat_secret' } : await verifyJWT(authHeader, supabaseUrl);
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

      const tripoKey = Deno.env.get('TRIPO_API_KEY');
      const status = tripoKey ? 'pending_3d_generation' : 'blocked_no_api_key';

      const { data: request, error } = await db.from('product_video_requests').insert({
        client_name: body.client_name || 'Dental Kart', product_name, category: body.category ?? null,
        brand: body.brand ?? null, key_feature_1: body.key_feature_1 ?? null, key_feature_2: body.key_feature_2 ?? null,
        key_feature_3: body.key_feature_3 ?? null, price: body.price ?? null, photo_paths,
        video_template: body.video_template ?? 'standard', status, submitted_by: user.userId,
        error_message: tripoKey ? null : 'TRIPO_API_KEY not configured — photos are saved, but 3D generation cannot run until this is added.',
      }).select('id').single();
      if (error) throw error;

      return okRes({
        request_id: request.id, status,
        message: tripoKey ? 'Submitted — 3D generation will begin.' : 'Photos and details saved. 3D model generation is NOT running yet — TRIPO_API_KEY needs to be added first. Nothing will silently "process" until then.',
      }, id);
    }

    if (body.action === 'generate_3d') {
      const { request_id } = body;
      if (!request_id) return errRes('request_id is required', 400, id);
      const tripoKey = Deno.env.get('TRIPO_API_KEY');
      if (!tripoKey) {
        await db.from('product_video_requests').update({ status: 'blocked_no_api_key', error_message: 'TRIPO_API_KEY not configured.' }).eq('id', request_id);
        return errRes('TRIPO_API_KEY is not configured — cannot generate 3D model. Add the key first.', 500, id);
      }
      const { data: reqRow, error: reqErr } = await db.from('product_video_requests').select('*').eq('id', request_id).single();
      if (reqErr || !reqRow) return errRes('Request not found', 404, id);

      await db.from('product_video_requests').update({ status: 'generating_3d' }).eq('id', request_id);

      try {
        // Step 1: download the actual photo bytes from Supabase Storage
        const photoPath = reqRow.photo_paths[0];
        const { data: fileBlob, error: dlErr } = await db.storage.from('product-video-photos').download(photoPath);
        if (dlErr || !fileBlob) throw new Error(`Could not download photo: ${dlErr?.message}`);

        // Step 2: upload to Tripo's /upload endpoint to get a file_token
        const formData = new FormData();
        formData.append('file', fileBlob, photoPath);
        const uploadRes = await fetch('https://api.tripo3d.ai/v2/openapi/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tripoKey}` },
          body: formData,
        });
        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          throw new Error(`Tripo upload failed: ${errText.slice(0, 300)}`);
        }
        const uploadData = await uploadRes.json();
        const fileToken = uploadData?.data?.image_token ?? uploadData?.data?.file_token;
        if (!fileToken) throw new Error(`Tripo upload succeeded but no file_token in response: ${JSON.stringify(uploadData).slice(0, 300)}`);

        // Step 3: submit the image_to_model task referencing that file_token
        const taskRes = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tripoKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'image_to_model',
            file: { type: extToTripoType(photoPath), file_token: fileToken },
            texture: true,
            pbr: true,
          }),
        });
        if (!taskRes.ok) {
          const errText = await taskRes.text();
          throw new Error(`Tripo task creation failed: ${errText.slice(0, 300)}`);
        }
        const taskData = await taskRes.json();
        const taskId = taskData?.data?.task_id;
        if (!taskId) throw new Error(`Tripo task created but no task_id in response: ${JSON.stringify(taskData).slice(0, 300)}`);

        await db.from('product_video_requests').update({
          status: 'generating_3d', model_3d_url: taskId,
          error_message: `Tripo task queued (id: ${taskId}). Poll GET https://api.tripo3d.ai/v2/openapi/task/${taskId} to know when the 3D model is ready — this engine does not yet auto-poll.`,
        }).eq('id', request_id);

        return okRes({ request_id, tripo_task_id: taskId, status: 'generating_3d', note: "Tripo task created for real. Video rendering (Blender/After Effects step) is NOT implemented in this engine yet — separate, larger follow-up once 3D generation itself is confirmed working end to end." }, id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.from('product_video_requests').update({ status: 'failed', error_message: msg }).eq('id', request_id);
        return errRes(msg, 500, id);
      }
    }

    if (body.action === 'check_3d_status') {
      const { request_id } = body;
      if (!request_id) return errRes('request_id is required', 400, id);
      const tripoKey = Deno.env.get('TRIPO_API_KEY');
      if (!tripoKey) return errRes('TRIPO_API_KEY not configured', 500, id);
      const { data: reqRow, error: reqErr } = await db.from('product_video_requests').select('*').eq('id', request_id).single();
      if (reqErr || !reqRow || !reqRow.model_3d_url) return errRes('No Tripo task associated with this request', 404, id);

      const statusRes = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${reqRow.model_3d_url}`, { headers: { Authorization: `Bearer ${tripoKey}` } });
      if (!statusRes.ok) return errRes(`Tripo status check failed: ${(await statusRes.text()).slice(0, 300)}`, 502, id);
      const statusData = await statusRes.json();
      const tripoStatus = statusData?.data?.status;
      const modelUrl = statusData?.data?.output?.pbr_model ?? statusData?.data?.output?.model;

      if (tripoStatus === 'success' && modelUrl) {
        await db.from('product_video_requests').update({ status: 'ready', model_3d_url: modelUrl, error_message: 'Real 3D model ready. Video rendering step is still not implemented — this is the raw 3D model file, not a finished video.' }).eq('id', request_id);
      } else if (tripoStatus === 'failed') {
        await db.from('product_video_requests').update({ status: 'failed', error_message: `Tripo generation failed: ${JSON.stringify(statusData?.data).slice(0, 300)}` }).eq('id', request_id);
      }

      return okRes({ request_id, tripo_status: tripoStatus, model_url: modelUrl ?? null, raw: statusData?.data }, id);
    }

    return errRes(`Unknown action: ${body.action}`, 400, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return errRes(msg, 500, id);
  }
});
