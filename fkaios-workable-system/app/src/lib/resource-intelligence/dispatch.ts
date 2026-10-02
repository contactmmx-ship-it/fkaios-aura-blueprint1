import { chooseResource } from './router';
import { createResourceGateway, type ResourceAdapter, type ResourceGateway } from './gateway';
import { verifyResourceDecision, type VerificationResult } from './verification';
import type { ResourceDecision, ResourceProvider, ResourceTask } from './types';

export interface ResourceDispatchResult {
  status: 'ready' | 'blocked';
  decision?: ResourceDecision;
  verification: VerificationResult;
  gateway?: ResourceGateway;
}

/**
 * Safe handoff boundary for FKAIOS workers.
 * A worker must not execute until the selected resource passes policy verification.
 */
export function prepareResourceDispatch(
  task: ResourceTask,
  providers: ResourceProvider[],
  adapters: ResourceAdapter[],
): ResourceDispatchResult {
  const decision = chooseResource(task, providers);
  if (!decision) {
    return {
      status: 'blocked',
      verification: {
        status: 'failed',
        providerId: 'none',
        taskId: task.id,
        evidence: [`task=${task.id}`, 'resource_selection=no_eligible_provider'],
        error: 'no_eligible_resource',
      },
    };
  }

  const verification = verifyResourceDecision(task, decision, providers);
  if (verification.status !== 'verified') {
    return { status: 'blocked', decision, verification };
  }

  const adapter = adapters.find((candidate) => candidate.providerId === decision.providerId);
  if (!adapter) {
    return {
      status: 'blocked',
      decision,
      verification: {
        status: 'failed',
        providerId: decision.providerId,
        taskId: task.id,
        evidence: [
          ...verification.evidence,
          `adapter=${decision.providerId}`,
          'execution_boundary=blocked',
        ],
        error: 'no_adapter_registered',
      },
    };
  }

  return {
    status: 'ready',
    decision,
    verification,
    gateway: createResourceGateway(adapters),
  };
}
