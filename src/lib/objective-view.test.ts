/// <reference lib="deno.ns" />
// Run: deno test src/lib/objective-view.test.ts
import { deriveObjectiveView, shouldPoll, type ObjectiveProgressData, type ObjectiveStatusRow } from './objective-view.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const OBJECTIVE = 'Research the Indian paint market and identify 20 potential distributors for Bharat Paints.';
// Exactly what objective-loop wrote for the live objective 79ef3604.
const BLOCKED_SUMMARY = [
  'BLOCKED: FKAIOS could not complete this objective because the required external research could not be verified with the currently available capabilities.',
  'REASON: "Identify and Shortlist 20 Potential Distributors" needs real-world data but no verified research source was available, so its output was rejected as ungrounded. Also failed: "Analyze Indian Paint Market Size and Segments" (capability knowledge.search dispatch error: HTTP 401: {"error":"Unauthorized"}).',
  'NEXT ACTION: Connect or enable a verified research capability, then re-run the objective.',
].join('\n');
// Live task set of 79ef3604 as the founder-objective status action returns it.
const LIVE_PROGRESS: ObjectiveProgressData = {
  planningPasses: 1, tasksTotal: 3, tasksVerified: 0, tasksActive: 1, tasksNoDataSource: 1, tasksFailed: 1, jobsRetrying: 1, jobsRunning: 0,
  tasks: [
    { title: 'Evaluate Distributor Profiles and Outreach Strategy', status: 'assigned', verdict: 'incomplete', reason: 'task still assigned' },
    { title: 'Analyze Indian Paint Market Size and Segments', status: 'done', verdict: 'failed', reason: 'capability knowledge.search dispatch error: HTTP 401' },
    { title: 'Identify and Shortlist 20 Potential Distributors', status: 'done', verdict: 'no_data_source', reason: 'recorded output needs real-world facts but has no capability evidence behind it' },
  ],
};
const VERIFIED_PROGRESS: ObjectiveProgressData = {
  planningPasses: 1, tasksTotal: 2, tasksVerified: 2, tasksActive: 0, tasksNoDataSource: 0, tasksFailed: 0, jobsRetrying: 0, jobsRunning: 0,
  tasks: [
    { title: 'Search knowledge vault for Bharat Paints brief', status: 'done', verdict: 'verified', reason: 'capability knowledge.search succeeded' },
    { title: 'Record summary in fleet_memory', status: 'done', verdict: 'verified', reason: 'internal task completed with recorded output' },
  ],
};

const row = (over: Partial<ObjectiveStatusRow>): ObjectiveStatusRow => ({
  id: '79ef3604-a2c1-432c-9519-54d721d6d556', raw_request: OBJECTIVE, status: 'processing', action_taken: null,
  result_summary: null, created_at: '2026-09-23T10:55:00Z', progress: LIVE_PROGRESS, ...over,
});
const blocked = () => row({ status: 'awaiting_approval', action_taken: 'objective_loop', result_summary: BLOCKED_SUMMARY });

Deno.test('1: processing objective shows its real stage and progress', () => {
  const v = deriveObjectiveView(row({}));
  assert(v.state === 'PROCESSING' && !v.terminal, 'processing, non-terminal');
  assert(v.stage === 'Executing', 'a task is active, so the stage is Executing');
  assert(v.progress.includes('0/3 tasks completed with verified evidence'), 'counts from real data');
  assert(v.progress.includes('1 task retrying after a failed attempt'), 'retry shown');
  const planning = deriveObjectiveView(row({ progress: { ...LIVE_PROGRESS, planningPasses: 0, tasksTotal: 0, tasksActive: 0, tasks: [] } }));
  assert(planning.stage === 'Accepted', 'no planning pass yet means Accepted');
  const verifying = deriveObjectiveView(row({ progress: VERIFIED_PROGRESS }));
  assert(verifying.stage === 'Verifying', 'all tasks settled means Verifying');
});

Deno.test('2: completed objective shows result, evidence-backed tasks and timestamp', () => {
  const v = deriveObjectiveView(row({ status: 'completed', action_taken: 'objective_loop', result_summary: 'Both tasks verified: the vault returned the Bharat Paints brief.', progress: VERIFIED_PROGRESS }));
  assert(v.state === 'COMPLETED' && v.terminal && v.stage === 'Completed', 'COMPLETED');
  assert(v.result === 'Both tasks verified: the vault returned the Bharat Paints brief.', 'final result');
  assert(v.completed.includes('Search knowledge vault for Bharat Paints brief (capability knowledge.search succeeded)'), 'evidence per task');
  assert(v.submittedAt === '2026-09-23T10:55:00Z', 'timestamp');
});

Deno.test('3: blocked objective shows result, what completed, what did not, why, and next action', () => {
  const v = deriveObjectiveView(blocked());
  assert(v.state === 'BLOCKED' && v.terminal && v.stage === 'Blocked', 'BLOCKED');
  assert(v.result!.startsWith('FKAIOS could not complete this objective because the required external research could not be verified'), 'result');
  assert(v.reason!.includes('rejected as ungrounded'), 'why');
  assert(v.nextAction === 'Connect or enable a verified research capability, then re-run the objective.', 'next action');
  assert(v.completed.length === 0, 'nothing completed with evidence');
  assert(v.notCompleted.some((l) => l.startsWith('Identify and Shortlist 20 Potential Distributors: not completed: needs real-world data')), 'distributor task listed as not completed');
  assert(v.notCompleted.some((l) => l.includes('HTTP 401')), 'failed vault search listed with its error');
});

Deno.test('4: failed objective shows the reason and whether retry is possible', () => {
  const v = deriveObjectiveView(row({ status: 'failed', action_taken: 'objective_loop', result_summary: 'Every provider failed: credit exhausted.' }));
  assert(v.state === 'FAILED' && v.terminal, 'FAILED');
  assert(v.reason === 'Every provider failed: credit exhausted.', 'reason');
  assert(v.retry!.startsWith('No automatic retry'), 'retry answer');
  assert(v.notCompleted.some((l) => l.includes('HTTP 401')), 'relevant task error');
});

Deno.test('5: awaiting approval shows the approval ask and points to Decision Center', () => {
  const v = deriveObjectiveView(row({ status: 'awaiting_approval', action_taken: null, progress: null }));
  assert(v.state === 'AWAITING_APPROVAL' && v.stage === 'Awaiting approval', 'AWAITING_APPROVAL');
  assert(v.result!.startsWith('Waiting for your approval'), 'what needs approval');
  assert(v.opensDecisionCenter, 'links to Decision Center');
});

Deno.test('6: the page keeps re-reading while processing and stops once the objective is terminal', () => {
  assert(shouldPoll([row({})]), 'polls while processing');
  assert(!shouldPoll([blocked()]), 'stops once blocked');
  assert(shouldPoll([blocked(), row({ id: 'other' })]), 'keeps polling while any objective is processing');
  assert(!shouldPoll([]), 'nothing to watch');
});

Deno.test('8: the same objective moves from Executing to Blocked; nothing stays "in progress"', () => {
  const before = deriveObjectiveView(row({}));
  const after = deriveObjectiveView(blocked());
  assert(before.stage === 'Executing' && after.stage === 'Blocked', 'stage transitions on the next read');
  assert(!after.progress.some((l) => /verification pending/i.test(l)), 'no pending wording once terminal');
});

Deno.test('9: fabricated output on the row is never part of the view', () => {
  const withOutput = { ...blocked(), output: '{"shortlisted_distributors":[{"company_name":"Shreeji Paints & Hardware Agency"}]}' } as ObjectiveStatusRow;
  const text = JSON.stringify(deriveObjectiveView(withOutput));
  assert(!text.includes('Shreeji') && !text.includes('shortlisted_distributors'), 'no fabricated content');
});
