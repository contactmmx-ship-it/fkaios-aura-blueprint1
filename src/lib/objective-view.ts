// Maps an objective row (orchestrator_requests + progress from the
// founder-objective `status` action) to what the Command Center shows.
// Pure and import-free so it is unit-tested directly.
//
// orchestrator_requests.status has no 'blocked' value (check constraint:
// processing | completed | failed | awaiting_approval). The objective loop
// records a block as awaiting_approval with action_taken='objective_loop';
// a high-risk objective waiting for sign-off before any work is
// awaiting_approval without it. That is the distinction used here.

export type ObjectiveState = 'PROCESSING' | 'BLOCKED' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED';

export interface ObjectiveProgressData {
  planningPasses: number;
  tasksTotal: number;
  tasksVerified: number;
  tasksActive: number;
  tasksNoDataSource: number;
  tasksFailed: number;
  jobsRetrying: number;
  jobsRunning: number;
}

export interface ObjectiveStatusRow {
  id: string;
  raw_request: string;
  status: string;
  action_taken: string | null;
  result_summary: string | null;
  progress?: ObjectiveProgressData | null;
}

export interface ObjectiveView {
  state: ObjectiveState;
  terminal: boolean;
  objective: string;
  result: string | null;
  reason: string | null;
  nextAction: string | null;
  progress: string[];
}

const LOOP_ACTION = 'objective_loop';

// Splits "BLOCKED: ...\nREASON: ...\nNEXT ACTION: ..." (fact-grounding.ts
// formatBlockedSummary) into its parts; any other text is kept whole.
function parseSummary(summary: string | null): { result: string | null; reason: string | null; nextAction: string | null } {
  if (!summary) return { result: null, reason: null, nextAction: null };
  let result: string | null = null;
  let reason: string | null = null;
  let nextAction: string | null = null;
  const loose: string[] = [];
  for (const line of summary.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    if (text.startsWith('BLOCKED:')) result = text.slice('BLOCKED:'.length).trim();
    else if (text.startsWith('REASON:')) reason = text.slice('REASON:'.length).trim();
    else if (text.startsWith('NEXT ACTION:')) nextAction = text.slice('NEXT ACTION:'.length).trim();
    else loose.push(text);
  }
  if (result === null && reason === null && nextAction === null) return { result: null, reason: loose.join(' '), nextAction: null };
  return { result, reason, nextAction };
}

export function progressLines(p: ObjectiveProgressData | null | undefined, processing: boolean): string[] {
  if (!p) return [];
  if (p.tasksTotal === 0) return [p.planningPasses === 0 ? 'Planning: waiting for the objective loop to break this into tasks' : 'Planning: no tasks recorded yet'];
  const lines = [`${p.tasksVerified}/${p.tasksTotal} tasks completed with verified evidence`];
  if (p.tasksActive > 0) lines.push(`${p.tasksActive} task${p.tasksActive === 1 ? '' : 's'} still in progress`);
  if (p.jobsRetrying > 0) lines.push(`${p.jobsRetrying} task${p.jobsRetrying === 1 ? '' : 's'} retrying after a failed attempt`);
  if (p.tasksNoDataSource > 0) lines.push(`${p.tasksNoDataSource} task${p.tasksNoDataSource === 1 ? '' : 's'} could not be verified (no research source)`);
  if (p.tasksFailed > 0) lines.push(`${p.tasksFailed} task${p.tasksFailed === 1 ? '' : 's'} failed`);
  if (processing && p.tasksActive === 0) lines.push('Verification pending: the objective loop evaluates the result on its next run');
  if (p.planningPasses > 1) lines.push(`Planning pass ${p.planningPasses}`);
  return lines;
}

export function deriveObjectiveView(row: ObjectiveStatusRow): ObjectiveView {
  const parsed = parseSummary(row.result_summary);
  const processing = row.status === 'processing';
  const base = { objective: row.raw_request, progress: progressLines(row.progress, processing) };
  if (row.status === 'completed') {
    return { ...base, state: 'COMPLETED', terminal: true, result: row.result_summary || 'Objective achieved and verified by the objective loop.', reason: null, nextAction: null };
  }
  if (row.status === 'failed') {
    return { ...base, state: 'FAILED', terminal: true, result: 'FKAIOS could not complete this objective.', reason: parsed.reason ?? parsed.result ?? 'No reason was recorded.', nextAction: parsed.nextAction };
  }
  if (row.status === 'awaiting_approval' && row.action_taken === LOOP_ACTION) {
    return {
      ...base,
      state: 'BLOCKED',
      terminal: true,
      result: parsed.result ?? 'FKAIOS stopped working on this objective and needs a decision before it can continue.',
      reason: parsed.reason,
      nextAction: parsed.nextAction ?? 'Review the reason above and decide how FKAIOS should proceed.',
    };
  }
  if (row.status === 'awaiting_approval') {
    return { ...base, state: 'AWAITING_APPROVAL', terminal: true, result: 'Assessed as high risk. No work starts until you approve it.', reason: null, nextAction: 'Approve or reject it in Decision Center.' };
  }
  return { ...base, state: 'PROCESSING', terminal: false, result: null, reason: null, nextAction: null };
}
