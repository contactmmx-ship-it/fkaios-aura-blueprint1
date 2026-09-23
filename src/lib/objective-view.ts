// Maps an objective row (orchestrator_requests + progress from the
// founder-objective `status` action) to what the Command Center shows.
// Pure and import-free so it is unit-tested directly.
//
// orchestrator_requests.status has no 'blocked' value (check constraint:
// processing | completed | failed | awaiting_approval). The objective loop
// records a block as awaiting_approval with action_taken='objective_loop';
// a high-risk objective waiting for sign-off before any work is
// awaiting_approval without it. That is the distinction used here.
//
// Nothing here reads task output: the only task data is title, status and
// the evidence verdict/reason computed server-side (objective-progress.ts),
// so a rejected or unverified answer can never be shown as a result.

export type ObjectiveState = 'PROCESSING' | 'BLOCKED' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED';
export type TaskVerdict = 'verified' | 'no_data_source' | 'failed' | 'incomplete';

export interface ObjectiveTaskData {
  title: string;
  status: string;
  verdict: TaskVerdict;
  reason?: string;
}

export interface ObjectiveProgressData {
  planningPasses: number;
  tasksTotal: number;
  tasksVerified: number;
  tasksActive: number;
  tasksNoDataSource: number;
  tasksFailed: number;
  jobsRetrying: number;
  jobsRunning: number;
  tasks?: ObjectiveTaskData[];
}

export interface ObjectiveStatusRow {
  id: string;
  raw_request: string;
  status: string;
  action_taken: string | null;
  result_summary: string | null;
  created_at?: string | null;
  progress?: ObjectiveProgressData | null;
}

// Real lifecycle stages. Each is derived from recorded state, never a timer:
// Accepted = row exists, no planning pass yet; Planning = a pass exists but
// has produced no tasks; Executing = a task is still active; Verifying = all
// tasks settled, the objective loop has not ruled yet.
export const STAGES = ['Accepted', 'Planning', 'Executing', 'Verifying'] as const;
export type Stage = typeof STAGES[number] | 'Completed' | 'Blocked' | 'Failed' | 'Awaiting approval';

export interface ObjectiveView {
  state: ObjectiveState;
  terminal: boolean;
  stage: Stage;
  objective: string;
  result: string | null;
  reason: string | null;
  nextAction: string | null;
  retry: string | null;
  completed: string[];
  notCompleted: string[];
  progress: string[];
  submittedAt: string | null;
  opensDecisionCenter: boolean;
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

function processingStage(p: ObjectiveProgressData | null | undefined): Stage {
  if (!p || p.planningPasses === 0) return 'Accepted';
  if (p.tasksTotal === 0) return 'Planning';
  if (p.tasksActive > 0) return 'Executing';
  return 'Verifying';
}

const VERDICT_TEXT: Record<Exclude<TaskVerdict, 'verified'>, string> = {
  no_data_source: 'not completed: needs real-world data and no verified research source was available',
  failed: 'failed',
  incomplete: 'still in progress',
};

function taskLists(p: ObjectiveProgressData | null | undefined): { completed: string[]; notCompleted: string[] } {
  const tasks = p?.tasks ?? [];
  return {
    completed: tasks.filter((t) => t.verdict === 'verified').map((t) => (t.reason ? `${t.title} (${t.reason})` : t.title)),
    notCompleted: tasks.filter((t) => t.verdict !== 'verified').map((t) => {
      const base = `${t.title}: ${VERDICT_TEXT[t.verdict as Exclude<TaskVerdict, 'verified'>] ?? t.verdict}`;
      return t.verdict === 'failed' && t.reason ? `${base} (${t.reason})` : base;
    }),
  };
}

export function progressLines(p: ObjectiveProgressData | null | undefined, processing: boolean): string[] {
  if (!p) return [];
  if (p.tasksTotal === 0) return [p.planningPasses === 0 ? 'Waiting for the objective loop to plan this objective' : 'Planning: no tasks recorded yet'];
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
  const base = {
    objective: row.raw_request,
    progress: progressLines(row.progress, processing),
    submittedAt: row.created_at ?? null,
    ...taskLists(row.progress),
    retry: null as string | null,
    opensDecisionCenter: false,
  };
  if (row.status === 'completed') {
    return { ...base, state: 'COMPLETED', stage: 'Completed', terminal: true, result: row.result_summary || 'Objective achieved and verified by the objective loop.', reason: null, nextAction: null };
  }
  if (row.status === 'failed') {
    return {
      ...base,
      state: 'FAILED',
      stage: 'Failed',
      terminal: true,
      result: 'FKAIOS could not complete this objective.',
      reason: parsed.reason ?? parsed.result ?? 'No reason was recorded.',
      nextAction: parsed.nextAction,
      retry: 'No automatic retry: FKAIOS does not re-run a failed objective. Resolve the reason above, then submit the objective again.',
    };
  }
  if (row.status === 'awaiting_approval' && row.action_taken === LOOP_ACTION) {
    return {
      ...base,
      state: 'BLOCKED',
      stage: 'Blocked',
      terminal: true,
      result: parsed.result ?? 'FKAIOS stopped working on this objective and needs a decision before it can continue.',
      reason: parsed.reason,
      nextAction: parsed.nextAction ?? 'Review the reason above and decide how FKAIOS should proceed.',
    };
  }
  if (row.status === 'awaiting_approval') {
    return {
      ...base,
      state: 'AWAITING_APPROVAL',
      stage: 'Awaiting approval',
      terminal: true,
      result: 'Waiting for your approval. The Founder Brain assessed this objective as high risk, so no work starts until you approve it.',
      reason: null,
      nextAction: 'Review it in Decision Center. Approving an objective from the console is not wired yet, so it is listed there read-only.',
      opensDecisionCenter: true,
    };
  }
  return { ...base, state: 'PROCESSING', stage: processingStage(row.progress), terminal: false, result: null, reason: null, nextAction: null };
}

// The Command Center re-reads status only while something can still change.
export function shouldPoll(rows: ObjectiveStatusRow[] | null): boolean {
  return (rows ?? []).some((row) => !deriveObjectiveView(row).terminal);
}
