# FKAIOS V1 Acceptance Gate

## Purpose

Prove that FKAIOS can take a founder's one-line objective and autonomously drive it from planning through verified completion without founder middleware.

## Controlled objective

> Research three facts about the Indian paint market, verify each fact from a source, and return a concise report with the sources.

## Required lifecycle

1. Accept the founder objective.
2. Persist the objective.
3. Assess risk.
4. Route to the appropriate department.
5. Generate an executable plan.
6. Persist executable tasks.
7. Select the workforce for each task.
8. Queue AI jobs.
9. Execute jobs through the AI engine.
10. Invoke required capabilities.
11. Persist execution evidence.
12. Evaluate the original objective, not merely task completion.
13. Retry, reassign, or replan when execution is unsuccessful.
14. Produce the final verified outcome.
15. Persist the execution state and reusable learning.

## Founder-middleware prohibition

The acceptance test fails if the founder must:

- select an agent manually;
- select a tool manually;
- copy output between agents;
- explain a failed task to another agent;
- restart a failed task manually;
- assemble the final answer manually;
- tell FKAIOS what happened after an execution failure.

## Verification requirements

A successful run must demonstrate:

- the original objective remains available to the evaluator;
- claimed completion is backed by execution evidence;
- failed capability execution cannot be recorded as successful;
- recovery/replanning is bounded and observable;
- the final response contains the requested three facts and their sources;
- the objective reaches a terminal state only after objective-level verification.

## Test scenarios

### A. Normal path

All required capabilities succeed on the first attempt.

Expected: objective completes without human intervention.

### B. Transient execution failure

Force one capability invocation to fail once and succeed on retry.

Expected: FKAIOS retries/recoveries automatically and still completes the objective.

### C. Bad evidence

Return an execution result that does not satisfy the objective.

Expected: objective evaluator rejects completion and triggers another planning pass.

### D. Persistent failure

Force a required capability to fail through the allowed retry/replan budget.

Expected: FKAIOS terminates safely as blocked/failed with a useful reason; it must not fabricate completion.

## Evidence to capture

For each run capture:

- objective/request identifier;
- planning pass number;
- task identifiers and statuses;
- selected workforce;
- AI job identifiers and statuses;
- capability invoked;
- capability execution result;
- evidence/output persisted;
- verification decision;
- retry/replan count;
- final objective status.

## Release gate

V1 is considered operational only when scenarios A, B, C, and D are demonstrably satisfied and the founder remains outside the execution loop.

## Next evolution layer

After this gate passes, add Capability Intelligence:

Objective -> required capabilities -> available capabilities -> capability gaps -> candidate discovery -> evaluation/test -> selection/integration -> execution -> verification -> reusable capability memory.

Do not replace the existing objective/work/AI execution kernel to add this layer.
