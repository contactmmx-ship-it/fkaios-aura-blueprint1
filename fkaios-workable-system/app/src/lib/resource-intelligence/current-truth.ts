import type { CurrentTruth } from './control';

export function createCurrentTruth(objective: string, strategy: string): CurrentTruth {
  return {
    objective,
    strategy,
    state: 'idle',
    updatedAt: new Date().toISOString(),
    decisions: [],
  };
}

export function lockDecision(truth: CurrentTruth, id: string, detail: string): CurrentTruth {
  return { ...truth, decisions: [...truth.decisions, { id, detail, status: 'locked' }], updatedAt: new Date().toISOString() };
}

export function supersedeDecision(truth: CurrentTruth, id: string, replacementDetail: string): CurrentTruth {
  return {
    ...truth,
    decisions: [...truth.decisions.map(d => d.id === id ? { ...d, status: 'superseded' as const } : d), { id: `${id}:replacement`, detail: replacementDetail, status: 'open' }],
    updatedAt: new Date().toISOString(),
  };
}
