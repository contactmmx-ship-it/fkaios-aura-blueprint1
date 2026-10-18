export interface NamedProvider {
  name: string;
}

/**
 * Enforce the no-spend default. Cloud providers are eligible only when the
 * operator explicitly marks the configured plan as free-tier, or explicitly
 * opts into paid fallback. With no free-tier markers, only self-hosted
 * inference remains eligible. This prevents a missing env flag from silently
 * enabling a billable provider.
 */
export function restrictProvidersForFreeTier<T extends NamedProvider>(
  providers: readonly T[],
  explicitlyFree: readonly string[],
  allowPaidFallback: boolean,
): T[] {
  if (allowPaidFallback) return [...providers];
  const free = new Set(explicitlyFree);
  return providers.filter((provider) => free.has(provider.name) || provider.name === "self_hosted");
}
