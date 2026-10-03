import type { ResourceTask } from './types';
import type { ResourceDispatchResult } from './dispatch';

export type ExecutionStatus = 'completed' | 'failed' | 'unknown' | 'blocked';
export interface ExecutionEvidence { startedAt:string; finishedAt:string; providerId?:string; attempt:number; status:ExecutionStatus; output?:unknown; error?:string }
export interface ExecutionResult { status:ExecutionStatus; taskId:string; evidence:ExecutionEvidence }
export async function executeResourceDispatch(task:ResourceTask, dispatch:ResourceDispatchResult, input:unknown, attempt=1):Promise<ExecutionResult>{
 const startedAt=new Date().toISOString();
 if(dispatch.status!=='ready'||!dispatch.gateway||!dispatch.decision) return {status:'blocked',taskId:task.id,evidence:{startedAt,finishedAt:new Date().toISOString(),attempt,status:'blocked',error:'dispatch_not_ready'}};
 try { const output=await dispatch.gateway.execute(task,dispatch.decision,input); return {status:'completed',taskId:task.id,evidence:{startedAt,finishedAt:new Date().toISOString(),providerId:dispatch.decision.providerId,attempt,status:'completed',output}}; }
 catch(error){ return {status:'unknown',taskId:task.id,evidence:{startedAt,finishedAt:new Date().toISOString(),providerId:dispatch.decision.providerId,attempt,status:'unknown',error:error instanceof Error?error.message:String(error)}}; }
}
