export interface NamedProvider {
  name: string;
}

/**
 * If the operator has explicitly marked one or more providers as free-tier,
 * restrict routing to those providers and self-hosted inference by default.
 * Paid fallback requires the explicit PROVIDER_ALLOW_PAID_FALLBACK=true opt-in.
 */
export function restrictProvidersForFreeTier<T extends NamedProvider>(
  providers: readonly T[],
  explicitlyFree: readonly string[],
  allowPaidFallback: boolean,
): T[] {
  if (explicitlyFree.length === 0 || allowPaidFallback) return [...providers];
  const free = new Set(explicitlyFree);
  return providers.filter((provider) => free.has(provider.name) || provider.name === "self_hosted");
}
