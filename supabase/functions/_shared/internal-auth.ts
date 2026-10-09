// Caller authentication for edge functions that serve both the signed-in
// founder (a user access token) and other FKAIOS functions (the project's
// server-side key).
//
// Why this exists: builder-engine decoded the bearer token itself and
// rejected anything that was not a three-segment JWT. This project's
// SUPABASE_SERVICE_ROLE_KEY is a modern `sb_secret_…` key (gateway log,
// 9 Oct 2026 08:04 UTC: `request.sb.apikey.authorization.prefix =
// sb_secret_…`), which is not a JWT. The gateway accepted the call
// (verify_jwt stays on; the platform mints a JWT for secret keys), and the
// function's own parser then answered 401 "Invalid JWT" — so every internal
// product build failed. It also trusted the role/sub claims of any JWT it was
// handed after only decoding it.
//
// The rules here:
//   - A server-side key is recognised only by exact, constant-time comparison
//     with a key this runtime holds. Never by a claim inside a token.
//   - Any other bearer token is a user token and is validated by Supabase
//     Auth (signature, expiry, revocation) via `getUser`; claims are never
//     read from an unverified token.
//   - Missing or malformed credentials are rejected before any database work.

export type Caller =
  | { kind: "service" }
  | { kind: "user"; userId: string; token: string };

export type AuthOutcome =
  | { ok: true; caller: Caller }
  | { ok: false; status: 401; error: string };

export interface AuthDeps {
  /** Server-side keys this runtime holds (empty values are ignored). */
  serviceKeys: Array<string | undefined | null>;
  /** Validates a user access token with Supabase Auth; null when invalid. */
  getUser: (token: string) => Promise<{ id: string } | null>;
}

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function authenticateCaller(authorizationHeader: string | null | undefined, deps: AuthDeps): Promise<AuthOutcome> {
  const token = bearerToken(authorizationHeader);
  if (!token) return { ok: false, status: 401, error: "Missing bearer credential" };

  for (const key of deps.serviceKeys) {
    if (key && timingSafeEqual(token, key)) return { ok: true, caller: { kind: "service" } };
  }

  // Anything else must be a user access token (a JWT). A non-JWT that is not
  // one of our keys is rejected without calling Auth.
  if (token.split(".").length !== 3) return { ok: false, status: 401, error: "Unrecognised credential" };
  let user: { id: string } | null = null;
  try {
    user = await deps.getUser(token);
  } catch {
    user = null;
  }
  if (!user?.id) return { ok: false, status: 401, error: "Invalid or expired user token" };
  return { ok: true, caller: { kind: "user", userId: user.id, token } };
}
