export interface NamedProvider {
  name: string;
}

/**
 * Enforce the founder's no-spend boundary.
 *
 * Paid providers are excluded unless the operator explicitly opts in with
 * PROVIDER_ALLOW_PAID_FALLBACK=true. An empty free-provider allowlist is not
 * permission to use paid APIs: in that case only self-hosted inference may run.
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
