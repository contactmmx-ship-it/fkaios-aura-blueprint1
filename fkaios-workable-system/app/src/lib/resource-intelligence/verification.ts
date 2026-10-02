import type { ResourceDecision, ResourceProvider, ResourceTask } from './types';

export type VerificationStatus = 'verified' | 'failed' | 'unknown';

export interface VerificationResult {
  status: VerificationStatus;
  providerId: string;
  taskId: string;
  evidence: string[];
  error?: string;
}

export function verifyResourceDecision(
  task: ResourceTask,
  decision: ResourceDecision,
  providers: ResourceProvider[],
): VerificationResult {
  const provider = providers.find((p) => p.id === decision.providerId);
  const evidence = [`task=${task.id}`, `provider=${decision.providerId}`];

  if (!provider) {
    return { status: 'failed', providerId: decision.providerId, taskId: task.id, evidence, error: 'provider_not_registered' };
  }
  if (!provider.enabled) {
    return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'provider_disabled' };
  }
  if (!provider.capabilities.includes(task.capability)) {
    return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'capability_mismatch' };
  }
  if (!task.allowPaid && provider.costMode === 'paid') {
    return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'paid_not_allowed' };
  }
  if (!task.allowCredit && provider.costMode === 'credit') {
    return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'credit_not_allowed' };
  }
  if (provider.costMode === 'credit') {
    if ((provider.creditBalanceUsd ?? 0) <= 0) {
      return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'credit_unavailable' };
    }
    if (provider.creditExpiresAt && new Date(provider.creditExpiresAt).getTime() <= Date.now()) {
      return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'credit_expired' };
    }
  }
  if (task.maxCostUsd !== undefined && (provider.unitCostUsd ?? 0) > task.maxCostUsd) {
    return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'cost_limit_exceeded' };
  }
  if (task.minContextWindow !== undefined && (provider.contextWindow ?? 0) < task.minContextWindow) {
    return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'context_window_too_small' };
  }
  if (task.deadlineMs !== undefined && (provider.latencyMs ?? 2000) > task.deadlineMs) {
    return { status: 'failed', providerId: provider.id, taskId: task.id, evidence, error: 'deadline_not_met' };
  }

  evidence.push('eligibility_checks=passed');
  return { status: 'verified', providerId: provider.id, taskId: task.id, evidence };
}
