import type { ResourceDecision, ResourceProvider, ResourceTask } from './types';

const QUALITY_WEIGHT = { economy: 0.25, balanced: 0.55, frontier: 0.95 } as const;
const IMPORTANCE_WEIGHT = { routine: 0.2, normal: 0.55, critical: 1 } as const;

export function chooseResource(task: ResourceTask, providers: ResourceProvider[]): ResourceDecision | null {
  const candidates = providers.filter((p) => {
    if (!p.enabled || !p.capabilities.includes(task.capability)) return false;
    if (!task.allowPaid && p.costMode === 'paid') return false;
    if (!task.allowCredit && p.costMode === 'credit') return false;
    if (task.minContextWindow !== undefined && (p.contextWindow ?? 0) < task.minContextWindow) return false;
    if (task.deadlineMs !== undefined && (p.latencyMs ?? 2000) > task.deadlineMs) return false;
    if (p.costMode === 'credit') {
      if ((p.creditBalanceUsd ?? 0) <= 0) return false;
      if (p.creditExpiresAt && new Date(p.creditExpiresAt).getTime() <= Date.now()) return false;
    }
    if (task.maxCostUsd !== undefined && (p.unitCostUsd ?? 0) > task.maxCostUsd) return false;
    return true;
  });

  if (!candidates.length) return null;

  const scored = candidates.map((p) => {
    const quality = p.reliability ?? 0.5;
    const latencyMs = p.latencyMs ?? 2000;
    const latency = Math.max(0, 1 - (latencyMs / 10000));
    const deadlineFit = task.deadlineMs === undefined ? 1 : Math.max(0, 1 - Math.max(0, latencyMs - task.deadlineMs) / Math.max(1, task.deadlineMs));
    const context = task.minContextWindow ? Math.min(1, (p.contextWindow ?? 0) / task.minContextWindow) : 1;
    const creditExpiresSoon = p.creditExpiresAt ? Math.max(0, new Date(p.creditExpiresAt).getTime() - Date.now()) < 7 * 24 * 60 * 60 * 1000 : false;
    const creditBonus = p.costMode === 'credit' ? (creditExpiresSoon ? 0.2 : 0.08) : 0;
    const preference = task.preferredProviders?.includes(p.id) ? 0.15 : 0;
    const costPenalty = Math.min(0.35, (p.unitCostUsd ?? 0) * (IMPORTANCE_WEIGHT[task.importance]));
    const score = QUALITY_WEIGHT[task.quality] * quality + latency * 0.15 + deadlineFit * 0.1 + context * 0.1 + creditBonus + preference - costPenalty + p.priority / 1000;
    return { provider: p, score };
  }).sort((a, b) => b.score - a.score);

  const winner = scored[0].provider;
  const reasons = [
    `capability=${task.capability}`,
    `quality=${task.quality}`,
    `cost_mode=${winner.costMode}`,
  ];
  if (winner.costMode === 'credit') reasons.push('uses available provider credit');
  if (task.preferredProviders?.includes(winner.id)) reasons.push('preferred provider');
  if ((winner.reliability ?? 0) >= 0.9) reasons.push('high reliability');

  return {
    providerId: winner.id,
    reason: reasons,
    estimatedCostUsd: winner.unitCostUsd ?? 0,
    score: scored[0].score,
  };
}
