import { describe, expect, it } from 'vitest';
import { chooseResource } from './router';
import type { ResourceProvider, ResourceTask } from './types';
import { verifyResourceDecision } from './verification';

const providers: ResourceProvider[] = [
  { id: 'local', name: 'Local', kind: 'local', enabled: true, priority: 10, capabilities: ['coding', 'general'], costMode: 'free', unitCostUsd: 0, reliability: 0.7, latencyMs: 250 },
  { id: 'credit', name: 'Credit Cloud', kind: 'cloud', enabled: true, priority: 20, capabilities: ['coding', 'reasoning'], costMode: 'credit', unitCostUsd: 0, reliability: 0.93, latencyMs: 700, creditBalanceUsd: 50, creditExpiresAt: '2099-01-01' },
  { id: 'frontier', name: 'Frontier', kind: 'model', enabled: true, priority: 30, capabilities: ['coding', 'reasoning'], costMode: 'paid', unitCostUsd: 0.04, reliability: 0.98, latencyMs: 1200 },
];

describe('chooseResource', () => {
  it('uses a credit-backed provider when paid use is not allowed', () => {
    const task: ResourceTask = { id: 't1', capability: 'reasoning', importance: 'normal', quality: 'balanced', allowPaid: false, allowCredit: true };
    expect(chooseResource(task, providers)?.providerId).toBe('credit');
  });

  it('uses a free local provider when credit and paid are unavailable', () => {
    const task: ResourceTask = { id: 't2', capability: 'coding', importance: 'routine', quality: 'economy', allowPaid: false, allowCredit: false };
    expect(chooseResource(task, providers)?.providerId).toBe('local');
  });

  it('rejects expired credit', () => {
    const expired = [{ ...providers[1], creditExpiresAt: '2000-01-01' }];
    const task: ResourceTask = { id: 't-expired', capability: 'reasoning', importance: 'normal', quality: 'balanced', allowPaid: false, allowCredit: true };
    expect(chooseResource(task, expired)).toBeNull();
  });

  it('rejects resources that cannot meet a hard deadline', () => {
    const task: ResourceTask = { id: 't-deadline', capability: 'reasoning', importance: 'critical', quality: 'balanced', deadlineMs: 300, allowPaid: true, allowCredit: false };
    expect(chooseResource(task, providers)).toBeNull();
  });

  it('verifies a selected provider against task policy', () => {
    const task: ResourceTask = { id: 't-verify', capability: 'reasoning', importance: 'normal', quality: 'balanced', allowPaid: false, allowCredit: true };
    const decision = chooseResource(task, providers)!;
    expect(verifyResourceDecision(task, decision, providers).status).toBe('verified');
  });

  it('blocks dispatch when the selected provider has no registered adapter', async () => {
    const { prepareResourceDispatch } = await import('./dispatch');
    const task: ResourceTask = { id: 't-adapter', capability: 'reasoning', importance: 'normal', quality: 'balanced', allowPaid: false, allowCredit: true };
    const result = prepareResourceDispatch(task, providers, []);
    expect(result.status).toBe('blocked');
    expect(result.verification.error).toBe('no_adapter_registered');
  });

  it('returns null when no eligible resource exists', () => {
    const task: ResourceTask = { id: 't3', capability: 'vision', importance: 'critical', quality: 'frontier', allowPaid: false, allowCredit: false };
    expect(chooseResource(task, providers)).toBeNull();
  });
});

import { createCreditLedger } from './credits';

describe('credit ledger', () => {
  it('reserves, consumes and releases credit without overspending', () => {
    const ledger = createCreditLedger([{ providerId: 'credit', balanceUsd: 10, reservedUsd: 0, enabled: true }]);
    const reservation = ledger.reserve('credit', 3, 'r1');
    expect(ledger.check('credit', 8).status).toBe('exhausted');
    expect(ledger.consume(reservation.id).status).toBe('consumed');
    expect(ledger.get('credit')?.balanceUsd).toBe(7);
    const r2 = ledger.reserve('credit', 2, 'r2');
    expect(ledger.release(r2.id).status).toBe('released');
    expect(ledger.get('credit')?.balanceUsd).toBe(7);
  });

  it('fails closed for expired credit', () => {
    const ledger = createCreditLedger([{ providerId: 'credit', balanceUsd: 10, reservedUsd: 0, enabled: true, expiresAt: '2000-01-01' }]);
    expect(ledger.check('credit', 1).status).toBe('expired');
    expect(() => ledger.reserve('credit', 1, 'expired')).toThrow('credit_expired');
  });
});
