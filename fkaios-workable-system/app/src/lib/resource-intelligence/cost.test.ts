import { describe, expect, it } from 'vitest';
import { createCostEngine } from './cost';
import { createCreditLedger } from './credits';
import type { ResourceProvider, ResourceTask } from './types';

const task: ResourceTask = { id: 'cost-1', capability: 'coding', importance: 'normal', quality: 'balanced', allowPaid: true, allowCredit: true };
const paid: ResourceProvider = { id: 'paid', name: 'Paid', kind: 'model', enabled: true, priority: 1, capabilities: ['coding'], costMode: 'paid', unitCostUsd: 0.08 };

describe('cost engine', () => {
  it('blocks a provider above the task ceiling', () => {
    expect(createCostEngine().estimate(paid, { ...task, maxCostUsd: 0.05 }).status).toBe('blocked');
  });
  it('blocks paid spend above the paid budget', () => {
    expect(createCostEngine().estimate(paid, task, { maxPaidCostUsd: 0.05 }).status).toBe('blocked');
  });
  it('checks credit availability before spend', () => {
    const ledger = createCreditLedger([{ providerId: 'credit', balanceUsd: 1, reservedUsd: 0, enabled: true }]);
    const credit = { ...paid, id: 'credit', costMode: 'credit' as const, unitCostUsd: 0.75 };
    expect(createCostEngine().canSpend(credit, 0.75, task, {}, ledger)).toBe(true);
    expect(createCostEngine().canSpend(credit, 1.25, task, {}, ledger)).toBe(false);
  });
});
