import type { Capability, ResourceProvider } from './types';

export interface ProviderRegistry {
  list(): ResourceProvider[];
  get(providerId: string): ResourceProvider | undefined;
  findByCapability(capability: Capability): ResourceProvider[];
  upsert(provider: ResourceProvider): void;
  disable(providerId: string): boolean;
}

export function createProviderRegistry(initial: ResourceProvider[] = []): ProviderRegistry {
  const providers = new Map(initial.map((provider) => [provider.id, provider]));

  return {
    list: () => [...providers.values()],
    get: (providerId) => providers.get(providerId),
    findByCapability: (capability) =>
      [...providers.values()].filter((provider) => provider.enabled && provider.capabilities.includes(capability)),
    upsert: (provider) => {
      if (!provider.id.trim()) throw new Error('provider_id_required');
      providers.set(provider.id, provider);
    },
    disable: (providerId) => {
      const provider = providers.get(providerId);
      if (!provider) return false;
      providers.set(providerId, { ...provider, enabled: false });
      return true;
    },
  };
}
