import type { ResourceDecision, ResourceTask } from './types';

export interface ResourceGateway {
  execute(task: ResourceTask, decision: ResourceDecision, input: unknown): Promise<unknown>;
}

export interface ResourceAdapter {
  providerId: string;
  execute(input: unknown, task: ResourceTask): Promise<unknown>;
}

export function createResourceGateway(adapters: ResourceAdapter[]): ResourceGateway {
  const byProvider = new Map(adapters.map((adapter) => [adapter.providerId, adapter]));
  return {
    async execute(task, decision, input) {
      const adapter = byProvider.get(decision.providerId);
      if (!adapter) throw new Error(`No adapter registered for provider: ${decision.providerId}`);
      return adapter.execute(input, task);
    },
  };
}
