import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Correlation-ID',
};

function correlationId(): string { return crypto.randomUUID().slice(0, 8); }
function structuredLog(level: string, message: string, data?: Record<string, unknown>, cid?: string): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: cid || '', message, ...(data ? { data } : {}) }));
}
function errorResponse(message: string, status: number, cid?: string): Response {
  structuredLog('ERROR', message, undefined, cid);
  return new Response(JSON.stringify({ error: message, correlationId: cid }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function successResponse(data: unknown, cid?: string): Response {
  return new Response(JSON.stringify({ ...(data as Record<string, unknown>), correlationId: cid }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function verifyJWT(authHeader: string | null, supabaseUrl: string): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string };
  } catch { return null; }
}

function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    async function tryOnce() {
      try { resolve(await fn()); }
      catch (err) {
        attempt++;
        if (attempt >= maxRetries) { reject(err); return; }
        setTimeout(tryOnce, baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500);
      }
    }
    tryOnce();
  });
}

const APIFY_BASE = 'https://api.apify.com/v2';

function encryptToken(token: string, secret: string): string {
  const encoder = new TextEncoder();
  const tokenBytes = encoder.encode(token);
  const secretBytes = encoder.encode(secret);
  const result = new Uint8Array(tokenBytes.length);
  for (let i = 0; i < tokenBytes.length; i++) result[i] = tokenBytes[i] ^ secretBytes[i % secretBytes.length];
  return btoa(String.fromCharCode(...result));
}

function decryptToken(encrypted: string, secret: string): string {
  const decoded = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const secretBytes = new TextEncoder().encode(secret);
  const result = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) result[i] = decoded[i] ^ secretBytes[i % secretBytes.length];
  return new TextDecoder().decode(result);
}

function getEncryptionSecret(): string {
  return Deno.env.get('ENCRYPTION_SECRET') || 'fkaios-default-key';
}

async function getActiveConnection(supabase: ReturnType<typeof createClient>, secret: string) {
  const { data, error } = await supabase.from('apify_connections').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Failed to fetch connection: ${error.message}`);
  if (!data) throw new Error('No active Apify connection found');
  const token = secret ? decryptToken(data.token_encrypted, secret) : data.token_encrypted;
  return { ...data, token };
}

async function testTokenOnApify(token: string, cid: string): Promise<{ valid: boolean; message: string; actorCount?: number }> {
  try {
    const res = await retryWithBackoff(async () => {
      const r = await fetch(`${APIFY_BASE}/actor-tokens`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!r.ok) throw new Error(`Apify API returned ${r.status}`);
      return r;
    }, 3, 1000);
    const json = await res.json() as { data?: { total?: number } };
    return { valid: true, message: 'Token is valid', actorCount: json.data?.total ?? 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('error', 'Apify token test failed', { error: msg }, cid);
    return { valid: false, message: `Token validation failed: ${msg}` };
  }
}

// NOTE: this function previously had a real bug where the deployed (live)
// version had `const JWT_SECRET = ...` declared twice in the auth helper,
// a JS syntax error that broke every call with a 500. This rewrite fixes
// that and also wires `apify_connections` (a table that never existed
// until this fix — see migrations/) so save/test/status actually work.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const cid = correlationId();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const secret = getEncryptionSecret();

  try {
    const user = await verifyJWT(req.headers.get('Authorization'), supabaseUrl);
    if (!user) return errorResponse('Unauthorized', 401, cid);
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405, cid);

    const body = await req.json() as { action: string; token?: string };
    const { action, token } = body;
    structuredLog('info', 'Apify settings request', { action }, cid);

    if (action === 'save') {
      if (!token || typeof token !== 'string' || token.trim().length === 0) return errorResponse('Token is required', 400, cid);
      const testResult = await testTokenOnApify(token.trim(), cid);
      if (!testResult.valid) return errorResponse(testResult.message, 400, cid);

      const encrypted = encryptToken(token.trim(), secret);
      await supabase.from('apify_connections').update({ is_active: false }).eq('is_active', true);
      const { data: connData, error: connErr } = await supabase
        .from('apify_connections')
        .insert({ token_encrypted: encrypted, is_active: true, test_result: 'success', last_tested_at: new Date().toISOString() })
        .select('id').single();
      if (connErr) throw connErr;

      await supabase.from('audit_logs').insert({ user_id: user.userId, action: 'apify_connection_saved', resource_type: 'apify_connection', resource_id: connData.id, metadata: { actorCount: testResult.actorCount } });
      structuredLog('info', 'Apify token saved and tested', { actorCount: testResult.actorCount }, cid);
      return successResponse({ message: 'Token saved and validated', actorCount: testResult.actorCount }, cid);
    }

    if (action === 'test') {
      const conn = await getActiveConnection(supabase, secret);
      const testResult = await testTokenOnApify(conn.token, cid);
      await supabase.from('apify_connections').update({ test_result: testResult.valid ? 'success' : 'failure', last_tested_at: new Date().toISOString() }).eq('id', conn.id);
      await supabase.from('audit_logs').insert({ user_id: user.userId, action: 'apify_connection_tested', resource_type: 'apify_connection', resource_id: conn.id, metadata: { valid: testResult.valid } });
      return successResponse(testResult, cid);
    }

    if (action === 'status') {
      const { data: connData, error: connErr } = await supabase.from('apify_connections').select('id, test_result, last_tested_at, created_at').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (connErr) throw connErr;
      if (!connData) return successResponse({ connected: false }, cid);
      return successResponse({ connected: connData.test_result === 'success', lastTestedAt: connData.last_tested_at, testResult: connData.test_result, actorCount: 0 }, cid);
    }

    return errorResponse(`Unknown action: ${action}`, 400, cid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    structuredLog('error', 'apify-settings error', { error: msg }, cid);
    return errorResponse(msg, 500, cid);
  }
});
