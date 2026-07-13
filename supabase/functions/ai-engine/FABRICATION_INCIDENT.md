# ai-engine v42 — FABRICATION REMOVED (2026-07-13)

## What happened
`executeJob()` ended in a catch-all that returned a **fabricated** object on ANY
failure (rate limit, API error, JSON parse):

```ts
} catch {
  return { result: `No LLM key configured — simulated placeholder for job type: ${job.type}` };
}
```

`runJobs()` then wrote that object with **`status: 'completed'`**.

`ANTHROPIC_API_KEY` **is** set — so the message lied about its own cause too.

## Blast radius (measured, not estimated)
- **5,970 jobs** recorded as completed work that **never happened**
- **2,982** fake `GENERATE_INVOICE`
- **2,982** fake `GENERATE_PROPOSAL`
- After quarantine, jobs still claiming `completed`: **ZERO**
  → **There was never any real completed work in this queue.** Every completion was a lie,
    while revenue was ₹0 and no invoice existed.

## Fix (v42)
- The `simulationMap` and the catch-all are **deleted**. Failures **throw**.
- `runJobs()` records `retry`/`failed` with the **real error**. Nothing invents a result.
- Unparseable LLM output is a **real failure**, not a placeholder.
- Engine **fails closed** (503) if no LLM key — it will not "simulate" its way through an outage.
- Every LLM call now writes the execution graph (model, provider, cost, tokens, department,
  business objective) to `agent_performance_metrics`.

## Cron state
- **cron 27** (`ai-engine-run-jobs-5min`) — **OFF**. It calls ai-engine with **no auth header**
  and always 401s. It was never the fabrication path; it is pure noise.
- **cron 23** (`job-scheduler-drain`) — **ON**. This IS the real path (invokes ai-engine
  run_jobs server-to-server). Safe now that ai-engine cannot fabricate.

## The rule this exists to enforce
**Any catch block that RETURNS data instead of re-throwing is a fake-data generator.**
An outage is visible. A fabrication is trusted. Fail loudly.
