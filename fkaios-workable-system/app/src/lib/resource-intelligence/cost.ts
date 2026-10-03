import type { ResourceProvider, ResourceTask } from './types';
import type { CreditLedger } from './credits';

export type BudgetStatus = 'allowed' | 'blocked';

export interface CostPolicy {
  maxTaskCostUsd?: number;
  maxPaidCostUsd?: number;
  preferFree?: boolean;
  preferCredits?: boolean;
}

export interface CostEstimate {
  providerId: string;
  estimatedCostUsd: number;
  costMode: ResourceProvider['costMode'];
  status: BudgetStatus;
  reason: string;
}

export interface CostEngine {
  estimate(provider: ResourceProvider, task: ResourceTask, policy?: CostPolicy): CostEstimate;
  canSpend(provider: ResourceProvider, amountUsd: number, task: ResourceTask, policy?: CostPolicy, ledger?: CreditLedger): boolean;
}

export function createCostEngine(): CostEngine {
  return {
    estimate(provider, task, policy = {}) {
      const estimatedCostUsd = Math.max(0, provider.unitCostUsd ?? 0);
      if (task.maxCostUsd !== undefined && estimatedCostUsd > task.maxCostUsd) {
        return { providerId: provider.id, estimatedCostUsd, costMode: provider.costMode, status: 'blocked', reason: 'task_cost_ceiling_exceeded' };
      }
      if (policy.maxTaskCostUsd !== undefined && estimatedCostUsd > policy.maxTaskCostUsd) {
        return { providerId: provider.id, estimatedCostUsd, costMode: provider.costMode, status: 'blocked', reason: 'budget_task_ceiling_exceeded' };
      }
      if (provider.costMode === 'paid' && policy.maxPaidCostUsd !== undefined && estimatedCostUsd > policy.maxPaidCostUsd) {
        return { providerId: provider.id, estimatedCostUsd, costMode: provider.costMode, status: 'blocked', reason: 'paid_cost_ceiling_exceeded' };
      }
      return { providerId: provider.id, estimatedCostUsd, costMode: provider.costMode, status: 'allowed', reason: 'cost_policy_allowed' };
    },
    canSpend(provider, amountUsd, task, policy = {}, ledger) {
      if (amountUsd < 0) return false;
      const estimate = this.estimate({ ...provider, unitCostUsd: amountUsd }, task, policy);
      if (estimate.status !== 'allowed') return false;
      if (provider.costMode === 'credit' && ledger) return ledger.check(provider.id, amountUsd).status === 'available';
      return true;
    },
  };
}
