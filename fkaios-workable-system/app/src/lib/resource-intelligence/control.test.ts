import { describe, expect, it } from 'vitest';
import { createCurrentTruth, runControlledTask } from './index';
import type { ResourceAdapter, ResourceProvider } from './index';

describe('FKAIOS controlled execution path', () => {
  it('runs select → verify → execute → truth update', async () => {
    const provider: ResourceProvider = { id:'test', name:'Test', kind:'model', enabled:true, priority:10, capabilities:['reasoning'], costMode:'free', latencyMs:10, reliability:1, contextWindow:10000 };
    const adapter: ResourceAdapter = { providerId:'test', async execute(input) { return { ok:true, input }; } };
    const result = await runControlledTask({
      providers:[provider], adapters:[adapter], truth:createCurrentTruth('x','y'), recovery:{maxAttempts:2,allowHandoff:true},
    }, { id:'task-1', capability:'reasoning', importance:'normal', quality:'balanced', allowPaid:false, allowCredit:false }, { hello:'world' }, 'worker-1');
    expect(result.execution?.status).toBe('completed');
    expect(result.truth.state).toBe('completed');
    expect(result.truth.currentProviderId).toBe('test');
  });
});
