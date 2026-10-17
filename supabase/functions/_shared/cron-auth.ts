/**
 * Validates cron authentication for Edge Functions that use a shared secret.
 * Prefer the header; retain query-string support for staged migration/rollback.
 * Callers must not log the supplied secret or full request URL.
 */
export function hasValidCronSecret(req: Request, expectedSecret: string): boolean {
  if (!expectedSecret) return false;
  const url = new URL(req.url);
  const provided = req.headers.get("x-heartbeat-secret") || url.searchParams.get("secret");
  return provided === expectedSecret;
}

/** Resolve deployed-compatible secret naming without exposing either value. */
export function resolveCronSecret(cronSecret: string | undefined, heartbeatSecret: string | undefined): string {
  return cronSecret || heartbeatSecret || "";
}
