// Render tests for the Command Center objective card (what Rajeev sees).
// Run:
//   npx esbuild src/components/fkaios/ObjectiveCommand.render.test.tsx --bundle --platform=node \
//     --jsx=automatic --alias:@=./src --outfile=/tmp/objective-render.test.cjs && node --test /tmp/objective-render.test.cjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObjectiveCard } from './ObjectiveCommand';
import type { ObjectiveStatusRow } from '@/lib/objective-view';

const OBJECTIVE = 'Research the Indian paint market and identify 20 potential distributors for Bharat Paints.';
const BLOCKED_SUMMARY = [
  'BLOCKED: FKAIOS could not complete this objective because the required external research could not be verified with the currently available capabilities.',
  'REASON: "Identify and Shortlist 20 Potential Distributors" needs real-world data but no verified research source was available, so its output was rejected as ungrounded.',
  'NEXT ACTION: Connect or enable a verified research capability, then re-run the objective.',
].join('\n');
const progress = { planningPasses: 1, tasksTotal: 3, tasksVerified: 0, tasksActive: 1, tasksNoDataSource: 1, tasksFailed: 1, jobsRetrying: 1, jobsRunning: 0 };
const row = (over: Partial<ObjectiveStatusRow>): ObjectiveStatusRow => ({ id: '79ef3604-a2c1-432c-9519-54d721d6d556', raw_request: OBJECTIVE, status: 'processing', action_taken: null, result_summary: null, progress, ...over });
const render = (r: ObjectiveStatusRow) => renderToStaticMarkup(<ObjectiveCard row={r} />);

test('1: processing objective renders PROCESSING and real progress', () => {
  const html = render(row({}));
  assert.match(html, /data-state="PROCESSING"/);
  assert.match(html, /0\/3 tasks completed with verified evidence/);
  assert.match(html, /1 task retrying after a failed attempt/);
});

test('2: blocked objective renders BLOCKED, the reason and the next action', () => {
  const html = render(row({ status: 'awaiting_approval', action_taken: 'objective_loop', result_summary: BLOCKED_SUMMARY }));
  assert.match(html, /Status: BLOCKED/);
  assert.match(html, /FKAIOS could not complete this objective because the required external research could not be verified/);
  assert.match(html, /rejected as ungrounded/);
  assert.match(html, /Connect or enable a verified research capability, then re-run the objective\./);
  assert.ok(html.includes(OBJECTIVE));
});

test('3: failed objective renders FAILED and its explanation', () => {
  const html = render(row({ status: 'failed', action_taken: 'objective_loop', result_summary: 'Every provider failed: credit exhausted.' }));
  assert.match(html, /Status: FAILED/);
  assert.match(html, /Every provider failed: credit exhausted\./);
});

test('4: completed objective renders its final result', () => {
  const html = render(row({ status: 'completed', action_taken: 'objective_loop', result_summary: 'All 3 tasks verified.' }));
  assert.match(html, /Status: COMPLETED/);
  assert.match(html, /All 3 tasks verified\./);
});

test('5: blocked objective does not render as running or in progress', () => {
  const html = render(row({ status: 'awaiting_approval', action_taken: 'objective_loop', result_summary: BLOCKED_SUMMARY }));
  assert.doesNotMatch(html, /animate-spin/);
  assert.doesNotMatch(html, /Running|Verification pending|PROCESSING/);
});

test('6: fabricated output on the row is never rendered', () => {
  const withOutput = { ...row({ status: 'awaiting_approval', action_taken: 'objective_loop', result_summary: BLOCKED_SUMMARY }), output: '{"shortlisted_distributors":[{"company_name":"Shreeji Paints & Hardware Agency"}]}' } as ObjectiveStatusRow;
  const html = render(withOutput);
  assert.doesNotMatch(html, /Shreeji|shortlisted_distributors/);
});
