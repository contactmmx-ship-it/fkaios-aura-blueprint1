// Render tests for the Command Center objective card (what Rajeev sees).
// Run:
//   NODE_PATH=./node_modules npx esbuild src/components/fkaios/ObjectiveCommand.render.test.tsx --bundle --platform=node \
//     --jsx=automatic --alias:@=./src --outfile=/tmp/objective-render.test.cjs && node --test /tmp/objective-render.test.cjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObjectiveCard } from './ObjectiveCommand';
import type { ObjectiveProgressData, ObjectiveStatusRow } from '@/lib/objective-view';

const OBJECTIVE = 'Research the Indian paint market and identify 20 potential distributors for Bharat Paints.';
const BLOCKED_SUMMARY = [
  'BLOCKED: FKAIOS could not complete this objective because the required external research could not be verified with the currently available capabilities.',
  'REASON: "Identify and Shortlist 20 Potential Distributors" needs real-world data but no verified research source was available, so its output was rejected as ungrounded.',
  'NEXT ACTION: Connect or enable a verified research capability, then re-run the objective.',
].join('\n');
const progress: ObjectiveProgressData = {
  planningPasses: 1, tasksTotal: 3, tasksVerified: 0, tasksActive: 1, tasksNoDataSource: 1, tasksFailed: 1, jobsRetrying: 1, jobsRunning: 0,
  tasks: [
    { title: 'Evaluate Distributor Profiles and Outreach Strategy', status: 'assigned', verdict: 'incomplete' },
    { title: 'Analyze Indian Paint Market Size and Segments', status: 'done', verdict: 'failed', reason: 'capability knowledge.search dispatch error: HTTP 401' },
    { title: 'Identify and Shortlist 20 Potential Distributors', status: 'done', verdict: 'no_data_source' },
  ],
};
const row = (over: Partial<ObjectiveStatusRow>): ObjectiveStatusRow => ({ id: '79ef3604-a2c1-432c-9519-54d721d6d556', raw_request: OBJECTIVE, status: 'processing', action_taken: null, result_summary: null, created_at: '2026-09-23T10:55:00Z', progress, ...over });
const blocked = () => row({ status: 'awaiting_approval', action_taken: 'objective_loop', result_summary: BLOCKED_SUMMARY });
const render = (r: ObjectiveStatusRow, onOpen?: () => void) => renderToStaticMarkup(<ObjectiveCard row={r} checkedAt="2026-09-23T16:10:00Z" onOpenDecisionCenter={onOpen} />);

test('1: processing objective renders the real stage and progress', () => {
  const html = render(row({}));
  assert.match(html, /data-state="PROCESSING"/);
  assert.match(html, /aria-current="step">Executing</);
  assert.match(html, /0\/3 tasks completed with verified evidence/);
});

test('2: completed objective renders the final result and evidence', () => {
  const html = render(row({
    status: 'completed', action_taken: 'objective_loop', result_summary: 'Both tasks verified.',
    progress: { ...progress, tasksVerified: 1, tasksActive: 0, tasks: [{ title: 'Search knowledge vault', status: 'done', verdict: 'verified', reason: 'capability knowledge.search succeeded' }] },
  }));
  assert.match(html, /Status: COMPLETED/);
  assert.match(html, /Both tasks verified\./);
  assert.match(html, /Completed with evidence/);
  assert.match(html, /Search knowledge vault \(capability knowledge\.search succeeded\)/);
  assert.match(html, /Submitted /);
});

test('3 + 7: blocked objective renders the terminal response: result, reason, not-completed tasks, next action', () => {
  const html = render(blocked());
  assert.match(html, /Status: BLOCKED/);
  assert.match(html, /aria-current="step">Blocked</);
  assert.match(html, /FKAIOS could not complete this objective because the required external research could not be verified/);
  assert.match(html, /rejected as ungrounded/);
  assert.match(html, /Not completed/);
  assert.match(html, /Identify and Shortlist 20 Potential Distributors: not completed/);
  assert.match(html, /Connect or enable a verified research capability, then re-run the objective\./);
  assert.ok(html.includes(OBJECTIVE));
});

test('4: failed objective renders FAILED, the reason and the retry answer', () => {
  const html = render(row({ status: 'failed', action_taken: 'objective_loop', result_summary: 'Every provider failed: credit exhausted.' }));
  assert.match(html, /Status: FAILED/);
  assert.match(html, /Every provider failed: credit exhausted\./);
  assert.match(html, /No automatic retry/);
});

test('5: awaiting approval renders the ask and the Decision Center button', () => {
  let opened = false;
  const html = render(row({ status: 'awaiting_approval', action_taken: null, progress: null }), () => { opened = true; });
  assert.match(html, /Status: AWAITING APPROVAL/);
  assert.match(html, /Waiting for your approval/);
  assert.match(html, /Open Decision Center/);
  assert.equal(opened, false);
});

test('6 + 8: after the backend blocks the objective, the next render is terminal with no running indicator', () => {
  const before = render(row({}));
  const after = render(blocked());
  assert.match(before, /animate-spin/);
  assert.doesNotMatch(after, /animate-spin/);
  assert.doesNotMatch(after, /Running|Verification pending|PROCESSING|aria-current="step">Executing/);
});

test('9: fabricated output on the row is never rendered', () => {
  const withOutput = { ...blocked(), output: '{"shortlisted_distributors":[{"company_name":"Shreeji Paints & Hardware Agency"}]}' } as ObjectiveStatusRow;
  assert.doesNotMatch(render(withOutput), /Shreeji|shortlisted_distributors/);
});
