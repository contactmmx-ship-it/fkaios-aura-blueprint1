# FKAIOS: Global AI Intelligence and the path from goal to verified outcome

**Status:** Direction and implementation plan. This document does not claim that the capabilities below are all implemented or operational.

## Why this matters

FKAIOS should not become another chatbot, a larger list of agents, or a dashboard full of integrations. The point is to give it a destination and have it work out a safe, practical route to that destination.

That means understanding the real state of a project, finding suitable resources already available, doing the work, checking the result and preserving enough evidence to continue after a failure or interruption.

We have experienced the opposite pattern ourselves: context spread across tools and conversations, repeated audits, plans that do not turn into working outcomes, and uncertainty about what is actually deployed. FKAIOS should reduce that coordination burden, not add another layer to it.

The guiding loop is:

**Understand the goal → inspect current state → discover options → evaluate → execute → verify → record what happened → continue.**

## Start with what FKAIOS already has

The existing autonomy architecture describes several parts of this loop:

- Capability discovery for supported model-provider catalogs.
- A resource registry with lifecycle and health information.
- Controlled evaluation using golden cases and a leased test queue.
- Resource selection and model-level fallback.
- Execution evidence, canonical objective state and checkpoint/resume.
- Independent objective verification, rectification and governed routing adoption.
- Explicit approval and spend controls.

These are foundations to extend, not systems to rebuild in parallel. Before changing implementation, check current code, migrations, production state and open pull requests. Treat a component as operational only when its real execution path and evidence support that claim.

Discovering models from provider catalogs is not the same as discovering every useful software tool, API, open-source project, MCP server or external service that could solve a project requirement.

## The capability we want to add

### 1. Discover solutions for a specific requirement

When FKAIOS identifies a missing capability, it should search relevant sources rather than crawl the entire internet without a purpose. Potential adapters to evaluate include GitHub repositories and releases, Hugging Face models and Spaces, MCP server registries, official API catalogues and vendor documentation, and curated AI-tool directories where they provide verifiable information.

Each candidate must be linked to the requirement it may solve. A result without a clear match to a real requirement should not enter the implementation queue.

### 2. Keep evidence with every candidate

Record, where available: name and canonical URL; source and date checked; matching requirement and reason; supported interfaces and prerequisites; licence and commercial-use restrictions; maintenance and release activity; cost and rate limits; credentials required; data handling, permissions and security concerns; evaluation status and test evidence.

Missing information must remain unknown. FKAIOS must not assume that a tool is safe, free, maintained or commercially usable merely because a page exists.

### 3. Evaluate before adopting

Use a governed lifecycle such as: discovered → eligible → testing → verified, rejected or blocked.

A discovered resource must not automatically become a production dependency. Test candidates in an isolated environment against a defined acceptance case. Compare results with the current solution, include cost and failure behaviour, and preserve the evidence.

Prefer reuse when it is safe, suitable and cheaper to maintain than a replacement. Develop something new when existing options fail the actual requirement or create unacceptable cost, security or operational risk.

### 4. Execute through the existing objective system

Discovery should produce a recommendation or controlled test request, not a parallel execution engine. Once a candidate is approved for testing, the existing objective, work, resource-selection, evidence and verification paths should do the work.

FKAIOS must distinguish between a resource being found, technically eligible, tested, verified against the requirement, approved for adoption, and deployed and confirmed working. These states are not interchangeable.

### 5. Preserve what was learned

Store the source, evaluation outcome, failure reason, cost and verification evidence so the next objective does not repeat the same research. Re-check time-sensitive details such as API availability, pricing, licences and maintenance before relying on old results.

## Global Collaboration Intelligence

A related but separate capability could identify people and organisations whose public work is relevant: researchers, maintainers, engineers, potential pilot users, incubators and strategic partners.

Start with public professional information and a clear reason for relevance. Store the source URL, the work that makes the person relevant and the date checked. Draft personalised outreach for human review; do not send messages, create accounts, scrape private data or imply endorsement automatically.

Find a relevant match, show the evidence, explain the reason and keep consequential actions behind an approval gate.

## Build in small, verifiable steps

### Phase 0 — Reconcile the truth

- Confirm this repository and branch are the active source of truth.
- Check open PRs, recent changes, migrations and deployed state before editing.
- Reuse existing discovery, evaluation, registry, objective state, evidence and approval systems.
- Record discrepancies rather than treating repository code as proof of production deployment.

**Exit condition:** an evidence-backed map of what works and what is genuinely missing.

### Phase 1 — Requirement-to-resource discovery

- Define a small, versioned candidate record and source-adapter interface.
- Start with one high-value source and one real FKAIOS requirement; do not build a broad crawler first.
- Deduplicate results and retain source URLs, timestamps and unknown fields.
- Test malformed results, duplicates, rate limits, stale data and unavailable sources.

**Exit condition:** FKAIOS finds a relevant candidate for a known missing capability and explains why it is worth testing.

### Phase 2 — Controlled evaluation

- Connect candidates to the existing evaluation queue and acceptance cases.
- Run tests in a bounded environment with time, token and spend limits.
- Keep discovered resources out of production routing until existing governance rules allow adoption.
- Record reproducible pass/fail evidence and useful failure reasons.

**Exit condition:** a candidate can be compared with the incumbent and independently checked.

### Phase 3 — One complete outcome

Choose one bounded objective and demonstrate the complete path: requirement → discovery → candidate evaluation → approved integration → real execution → independent verification → saved checkpoint and evidence.

**Exit condition:** the application or workflow works, evidence is visible, and failure is not reported as success.

### Phase 4 — Broader discovery and collaboration

Only after the first workflow is reliable, add more source adapters, scheduled refreshes, candidate ranking and collaboration discovery. Measure usefulness by relevant candidates verified and time saved, not by the number of tools indexed.

## Safety and operating rules

- No paid API, subscription, infrastructure or model fallback without applicable explicit spend permission.
- No production deployment, migration, external communication, account creation or irreversible action merely because a candidate was discovered.
- Keep credentials in the approved secret store; never write secrets into code, candidate records or logs.
- Use least-privilege access and isolate untrusted repositories, packages and code before running them.
- Preserve working behaviour; make incremental changes and cover them with regression tests.
- If verification cannot be completed, report the blocker instead of claiming success.

## How we will measure progress

1. Can FKAIOS identify the actual missing requirement from current project state?
2. Can it find a relevant existing option and provide evidence for the match?
3. Can it distinguish unknown, ineligible, tested and verified resources?
4. Can it test a candidate without affecting production or incurring unapproved spend?
5. Can it integrate the chosen solution through the existing execution path?
6. Can an independent check confirm the requested outcome?
7. Can FKAIOS resume after interruption without repeating completed work or losing evidence?
8. Does the workflow save measurable time compared with doing the same task manually?

## Immediate next step

Do not start by building a new global agent or adding another dashboard. First map the existing discovery and evaluation code to these requirements, including the active implementation and open PRs. Then choose one missing capability and take it all the way to a verified result.

The aim is not to prove that FKAIOS has the biggest collection of AI tools. It is to prove that FKAIOS can choose the right resource for a real goal and use it to deliver a result we can trust.
