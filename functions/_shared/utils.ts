export function correlationId(): string { return crypto.randomUUID().slice(0, 8); }
export function structuredLog(level: string, message: string, data?: Record<string, unknown>, cid?: string): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, correlationId: cid || '', message, ...(data ? { data } : {}) }));
}
export function errorResponse(message: string, status: number, details?: string, cid?: string): Response {
  structuredLog('ERROR', message, { status, details }, cid);
  return new Response(JSON.stringify({ error: message, ...(details ? { details } : {}), ...(cid ? { correlationId: cid } : {}) }), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE' } });
}
export function successResponse(data: unknown, status = 200, cid?: string): Response {
  return new Response(JSON.stringify({ ...((data as Record<string, unknown>) || {}), ...(cid ? { correlationId: cid } : {}) }), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE' } });
}
export function verifyEnvSecrets(required: Record<string, string | undefined>): string | null {
  const missing: string[] = [];
  for (const [name, value] of Object.entries(required)) { if (!value) missing.push(name); }
  return missing.length > 0 ? `Missing required secrets: ${missing.join(', ')}` : null;
}
export async function verifyJWT(authHeader: string, supabaseUrl: string, supabaseAnonKey: string): Promise<{ userId: string; role: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub as string, role: (payload.user_role as string) || payload.role || 'authenticated' };
  } catch { return null; }
}
