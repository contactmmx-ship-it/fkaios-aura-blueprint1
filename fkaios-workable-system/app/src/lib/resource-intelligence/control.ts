import type { ResourceProvider, ResourceTask, ResourceDecision } from './types';
import { prepareResourceDispatch, type ResourceDispatchResult } from './dispatch';
import { executeResourceDispatch, type ExecutionResult } from './execution';
import { decideRecovery, type RecoveryDecision, type RecoveryPolicy } from './recovery';
import { createActivityTrail, type ActivityTrail } from './activity';

export type GateKind = 'spend' | 'production' | 'external_communication' | 'legal_financial' | 'locked_decision';
export interface HumanGate { kind: GateKind; required: boolean; reason: string; approved: boolean; }
export interface CurrentTruth {
  objective: string;
  strategy: string;
  state: 'idle' | 'running' | 'waiting' | 'blocked' | 'completed' | 'unknown';
  currentTaskId?: string;
  currentWorkerId?: string;
  currentProviderId?: string;
  lastConfirmedEvent?: string;
  nextAction?: string;
  updatedAt: string;
  decisions: Array<{ id: string; status: 'locked' | 'open' | 'superseded'; detail: string }>;
}

export interface ControlContext {
  providers: ResourceProvider[];
  adapters: Parameters<typeof prepareResourceDispatch>[2];
  activity?: ActivityTrail;
  truth: CurrentTruth;
  recovery: RecoveryPolicy;
  humanGates?: HumanGate[];
}

export interface ControlRunResult {
  dispatch: ResourceDispatchResult;
  execution?: ExecutionResult;
  recovery?: RecoveryDecision;
  truth: CurrentTruth;
}

function updateTruth(ctx: ControlContext, patch: Partial<CurrentTruth>): CurrentTruth {
  ctx.truth = { ...ctx.truth, ...patch, updatedAt: new Date().toISOString() };
  return ctx.truth;
}

export async function runControlledTask(
  ctx: ControlContext,
  task: ResourceTask,
  input: unknown,
  workerId = 'worker-unassigned',
): Promise<ControlRunResult> {
  const activity = ctx.activity ?? createActivityTrail();
  updateTruth(ctx, { state: 'running', currentTaskId: task.id, currentWorkerId: workerId, nextAction: 'resource_selection' });
  activity.append({ taskId: task.id, phase: 'task', status: 'running', title: 'Task started', detail: task.id });

  const dispatch = prepareResourceDispatch(task, ctx.providers, ctx.adapters);
  if (dispatch.status !== 'ready' || !dispatch.decision) {
    activity.append({ taskId: task.id, phase: 'resource', status: 'blocked', title: 'Resource dispatch blocked', detail: dispatch.verification.error });
    updateTruth(ctx, { state: 'blocked', nextAction: 'resolve_resource_or_human_gate', lastConfirmedEvent: 'resource_dispatch_blocked' });
    return { dispatch, truth: ctx.truth };
  }

  updateTruth(ctx, { currentProviderId: dispatch.decision.providerId, nextAction: 'execution' });
  activity.append({ taskId: task.id, phase: 'resource', status: 'completed', title: 'Resource selected', providerId: dispatch.decision.providerId, detail: dispatch.decision.reason.join('; ') });
  activity.append({ taskId: task.id, phase: 'verification', status: 'completed', title: 'Resource policy verified', providerId: dispatch.decision.providerId });

  const execution = await executeResourceDispatch(task, dispatch, input);
  activity.append({ taskId: task.id, phase: 'execution', status: execution.status === 'completed' ? 'completed' : execution.status, title: `Execution ${execution.status}`, providerId: execution.evidence.providerId, attempt: execution.evidence.attempt, detail: execution.evidence.error });
  const recovery = decideRecovery(task, execution, ctx.recovery);
  if (recovery.action !== 'halt') activity.append({ taskId: task.id, phase: 'recovery', status: 'running', title: `Recovery: ${recovery.action}`, detail: recovery.reason });

  const state = execution.status === 'completed' ? 'completed' : execution.status === 'unknown' ? 'unknown' : execution.status === 'blocked' ? 'blocked' : 'waiting';
  updateTruth(ctx, { state, nextAction: recovery.action === 'halt' ? 'next_task' : recovery.action, lastConfirmedEvent: `execution_${execution.status}` });
  return { dispatch, execution, recovery, truth: ctx.truth };
}
