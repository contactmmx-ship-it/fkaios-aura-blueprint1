import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Content-Type': 'application/json',
};
function ok(d: unknown) { return new Response(JSON.stringify(d), { status: 200, headers: CORS }); }
function err(m: string, s = 500) { return new Response(JSON.stringify({ error: m }), { status: s, headers: CORS }); }

const APIFY_BASE = 'https://api.apify.com/v2';

function xor(input: Uint8Array, secret: string): Uint8Array {
  const s = new TextEncoder().encode(secret);
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ s[i % s.length];
  return out;
}
function encryptToken(token: string, secret: string): string {
  return btoa(String.fromCharCode(...xor(new TextEncoder().encode(token), secret)));
}
function decryptToken(encrypted: string, secret: string): string {
  return new TextDecoder().decode(xor(Uint8Array.from(atob(encrypted), c => c.charCodeAt(0)), secret));
}

// Use /v2/users/me — Apify's canonical identity-check endpoint. More
// reliable than /v2/actor-tokens, which may require different scopes.
async function testTokenOnApify(token: string): Promise<{ valid: boolean; message: string; username?: string }> {
  try {
    const r = await fetch(`${APIFY_BASE}/users/me?token=${encodeURIComponent(token)}`);
    const bodyText = await r.text();
    if (!r.ok) {
      return { valid: false, message: `Apify rejected token — HTTP ${r.status}: ${bodyText.slice(0, 250)}` };
    }
    const json = JSON.parse(bodyText) as { data?: { username?: string; id?: string } };
    return { valid: true, message: 'Token is valid', username: json.data?.username ?? json.data?.id ?? 'unknown' };
  } catch (e) {
    return { valid: false, message: `Validation request failed: ${e instanceof Error ? e.message : 'network error'}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const secret = Deno.env.get('ENCRYPTION_SECRET') || 'fkaios-default-key';
    if (!supabaseUrl || !supabaseAnon) return err('Missing Supabase env');

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
    const parts = authHeader.slice(7).split('.');
    if (parts.length !== 3) return err('Invalid JWT', 401);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Date.now() / 1000) return err('JWT expired', 401);
    const userId = payload.sub as string;

    const db = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });

    if (req.method !== 'POST') return err('Method not allowed', 405);
    const body = await req.json() as { action?: string; token?: string };
    const { action } = body;
    const token = body.token?.trim();

    if (action === 'save') {
      if (!token) return err('Token is required', 400);
      const test = await testTokenOnApify(token);
      if (!test.valid) return err(test.message, 400);
      const encrypted = encryptToken(token, secret);
      await db.from('apify_connections').update({ is_active: false }).eq('is_active', true);
      const { data, error } = await db.from('apify_connections').insert({
        token_encrypted: encrypted,
        is_active: true,
        test_result: 'success',
        last_tested_at: new Date().toISOString(),
        created_by: userId,
      }).select('id').single();
      if (error) return err(`DB insert failed: ${error.message}`);
      return ok({ message: 'Token saved and validated', username: test.username, connectionId: data.id });
    }

    if (action === 'test') {
      const { data, error } = await db.from('apify_connections').select('*').eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) return err(error.message);
      if (!data) return err('No active Apify connection found — save a token first', 404);
      const decrypted = decryptToken(data.token_encrypted, secret);
      const test = await testTokenOnApify(decrypted);
      await db.from('apify_connections').update({
        test_result: test.valid ? 'success' : 'failure',
        last_tested_at: new Date().toISOString(),
      }).eq('id', data.id);
      return ok(test);
    }

    if (action === 'status') {
      const { data, error } = await db.from('apify_connections')
        .select('id, test_result, last_tested_at, created_at').eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) return err(error.message);
      if (!data) return ok({ connected: false });
      return ok({ connected: data.test_result === 'success', lastTestedAt: data.last_tested_at, testResult: data.test_result });
    }

    if (action === 'disconnect') {
      await db.from('apify_connections').update({ is_active: false }).eq('is_active', true);
      return ok({ message: 'Disconnected' });
    }

    return err(`Unknown action: ${action}`, 400);
  } catch (e) {
    return err(`Uncaught: ${e instanceof Error ? e.message : String(e)}`);
  }
});
