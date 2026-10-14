/** Build a public, directly addressable URL for persisted generated HTML.
 * The products-public Edge Function is intentionally unauthenticated and reads
 * only the requested build artifact. This avoids routing public products
 * through the protected internal Console domain.
 */
export function buildPublicProductUrl(supabaseUrl: string, buildId: string): string {
  if (!buildId.trim()) throw new Error("buildId is required");
  const base = new URL(supabaseUrl);
  if (base.protocol !== "https:" || !base.hostname || base.username || base.password) {
    throw new Error("SUPABASE_URL must be a valid HTTPS origin");
  }
  const endpoint = new URL("/functions/v1/products-public", base.origin);
  endpoint.searchParams.set("build_id", buildId);
  return endpoint.toString();
}
