import type { ResourceTask } from './types';
import type { ExecutionResult } from './execution';
export type RecoveryAction='verify_before_retry'|'retry'|'handoff'|'halt';
export interface RecoveryDecision{action:RecoveryAction;reason:string;nextAttempt:number}
export interface RecoveryPolicy{maxAttempts:number;allowHandoff:boolean}
export function decideRecovery(task:ResourceTask,result:ExecutionResult,policy:RecoveryPolicy):RecoveryDecision{
 const attempt=result.evidence.attempt;
 if(result.status==='completed') return {action:'halt',reason:'execution_completed',nextAttempt:attempt};
 if(result.status==='blocked') return {action:'halt',reason:'execution_blocked',nextAttempt:attempt};
 if(result.status==='unknown') return {action:'verify_before_retry',reason:'outcome_unknown_requires_verification',nextAttempt:attempt+1};
 if(attempt>=policy.maxAttempts) return {action:'halt',reason:`max_attempts_reached:${task.id}`,nextAttempt:attempt};
 return policy.allowHandoff?{action:'handoff',reason:'worker_or_resource_handoff_allowed',nextAttempt:attempt+1}:{action:'retry',reason:'retry_allowed',nextAttempt:attempt+1};
}
