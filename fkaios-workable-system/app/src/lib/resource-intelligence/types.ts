export type ProviderKind = 'cloud' | 'model' | 'local' | 'tool';
export type Capability = 'reasoning' | 'coding' | 'vision' | 'embeddings' | 'search' | 'browser' | 'speech' | 'general';
export type CostMode = 'free' | 'credit' | 'paid';

export interface ResourceProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  enabled: boolean;
  priority: number;
  capabilities: Capability[];
  costMode: CostMode;
  unitCostUsd?: number;
  latencyMs?: number;
  reliability?: number;
  contextWindow?: number;
  creditBalanceUsd?: number;
  creditExpiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ResourceTask {
  id: string;
  capability: Capability;
  importance: 'routine' | 'normal' | 'critical';
  quality: 'economy' | 'balanced' | 'frontier';
  maxCostUsd?: number;
  deadlineMs?: number;
  minContextWindow?: number;
  allowPaid: boolean;
  allowCredit: boolean;
  preferredProviders?: string[];
}

export interface ResourceDecision {
  providerId: string;
  reason: string[];
  estimatedCostUsd: number;
  score: number;
}
