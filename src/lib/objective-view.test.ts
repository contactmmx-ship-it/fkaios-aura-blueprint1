/// <reference lib="deno.ns" />
// Run: deno test src/lib/objective-view.test.ts
import { deriveObjectiveView, type ObjectiveStatusRow } from './objective-view.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const OBJECTIVE = 'Research the Indian paint market and identify 20 potential distributors for Bharat Paints.';
// Exactly what objective-loop writes (fact-grounding.ts formatBlockedSummary).
const BLOCKED_SUMMARY = [
  'BLOCKED: FKAIOS could not complete this objective because the required external research could not be verified with the currently available capabilities.',
  'REASON: "Identify and Shortlist 20 Potential Distributors" needs real-world data but no verified research source was available, so its output was rejected as ungrounded.',
  'NEXT ACTION: Connect or enable a verified research capability, then re-run the objective.',
].join('\n');
const progress = { planningPasses: 1, tasksTotal: 3, tasksVerified: 0, tasksActive: 1, tasksNoDataSource: 1, tasksFailed: 1, jobsRetrying: 1, jobsRunning: 0 };

const row = (over: Partial<ObjectiveStatusRow>): ObjectiveStatusRow => ({ id: '79ef3604', raw_request: OBJECTIVE, status: 'processing', action_taken: null, result_summary: null, progress, ...over });

Deno.test('1: processing objective shows PROCESSING with real progress', () => {
  const v = deriveObjectiveView(row({}));
  assert(v.state === 'PROCESSING' && !v.terminal, 'must be processing, non-terminal');
  assert(v.progress.includes('0/3 tasks completed with verified evidence'), 'task count from real data');
  assert(v.progress.includes('1 task retrying after a failed attempt'), 'retry count shown');
  assert(v.progress.includes('1 task still in progress'), 'active task shown');
});

Deno.test('1b: processing objective with no project yet shows Planning', () => {
  const v = deriveObjectiveView(row({ progress: { ...progress, planningPasses: 0, tasksTotal: 0, tasksActive: 0, tasksNoDataSource: 0, tasksFailed: 0, jobsRetrying: 0 } }));
  assert(v.progress[0].startsWith('Planning'), 'planning state');
});

Deno.test('2: blocked objective shows BLOCKED with result, reason and next action', () => {
  const v = deriveObjectiveView(row({ status: 'awaiting_approval', action_taken: 'objective_loop', result_summary: BLOCKED_SUMMARY }));
  assert(v.state === 'BLOCKED' && v.terminal, 'must be BLOCKED and terminal');
  assert(v.result!.startsWith('FKAIOS could not complete this objective'), 'result text');
  assert(v.reason!.includes('rejected as ungrounded'), 'reason text');
  assert(v.nextAction === 'Connect or enable a verified research capability, then re-run the objective.', 'next action text');
  assert(v.objective === OBJECTIVE, 'objective text');
});

Deno.test('2b: high-risk objective awaiting sign-off is AWAITING_APPROVAL, not BLOCKED', () => {
  const v = deriveObjectiveView(row({ status: 'awaiting_approval', action_taken: null }));
  assert(v.state === 'AWAITING_APPROVAL', 'awaiting approval');
});

Deno.test('3: failed objective shows FAILED and its explanation', () => {
  const v = deriveObjectiveView(row({ status: 'failed', action_taken: 'objective_loop', result_summary: 'Every provider failed: credit exhausted.' }));
  assert(v.state === 'FAILED' && v.terminal, 'FAILED');
  assert(v.reason === 'Every provider failed: credit exhausted.', 'reason from result_summary');
});

Deno.test('4: completed objective shows its final result', () => {
  const v = deriveObjectiveView(row({ status: 'completed', action_taken: 'objective_loop', result_summary: 'All 3 tasks verified: knowledge.search returned 12 documents.' }));
  assert(v.state === 'COMPLETED' && v.terminal, 'COMPLETED');
  assert(v.result === 'All 3 tasks verified: knowledge.search returned 12 documents.', 'final result');
});

Deno.test('5: a blocked objective never shows as processing/running, even with a task still active', () => {
  const v = deriveObjectiveView(row({ status: 'awaiting_approval', action_taken: 'objective_loop', result_summary: BLOCKED_SUMMARY }));
  assert(v.state !== 'PROCESSING' && v.terminal, 'terminal');
  assert(!v.progress.some((l) => /verification pending|running/i.test(l)), 'no running/pending wording');
});

Deno.test('6: the view is built only from the summary and counts; no task output field is read', () => {
  const withOutput = { ...row({ status: 'awaiting_approval', action_taken: 'objective_loop', result_summary: BLOCKED_SUMMARY }), output: '{"shortlisted_distributors":[{"company_name":"Shreeji Paints & Hardware Agency"}]}' } as ObjectiveStatusRow;
  const text = JSON.stringify(deriveObjectiveView(withOutput));
  assert(!text.includes('Shreeji') && !text.includes('shortlisted_distributors'), 'fabricated content must not appear');
});
