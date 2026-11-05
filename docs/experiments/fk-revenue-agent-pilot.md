# FK Revenue Agent — Feasibility Pilot

Status: design/implementation checkpoint; not deployed or live-tested.
Branch: pilot/fk-revenue-agent-feasibility

## Objective

Test one narrow claim: can an existing FKAIOS objective use the current objective pipeline, authorised research, and existing CRM/business data to produce a qualified, evidence-backed FK sales opportunity and a founder-approved offer draft—without autonomous external contact or spending?

This pilot is **not** a Conway clone, wallet, self-replicating agent, or new parallel agent framework.

## Reuse-first findings (source inspection, 5 Nov 2026)

- The current objective entry point is `supabase/functions/founder-objective/index.ts`; it feeds the existing founder-brain/objective loop.
- `supabase/functions/_shared/objective-loop.ts` already plans, allocates work, verifies deliverables and records blocked/failed outcomes.
- `supabase/functions/ai-engine/index.ts` uses the shared resource selector/router and capability execution; it explicitly fails rather than fabricating work.
- `supabase/functions/_shared/company-os.ts` is the capability registry/dispatcher. It currently marks `research.run`, `research.status`, `knowledge.search`, `whatsapp.send_message` and system read-only checks as verified. It lists many CRM/sales/accounting functions by filename, but does not establish their callable interfaces. `crm.pipeline_audit` is a read-only audit, not lead creation or outreach.
- The same registry marks `accounting.record` and `approvals.check` unverified. Do not dispatch them.
- The Founder Brain context type includes leads, revenue, payments, meetings and memory, but that interface alone does not prove current live data quality or access.
- A separate legacy `agent-engine` directly calls Anthropic and falls back to Gemini; it is not the preferred route for this pilot because the current objective pipeline already has shared routing, execution evidence and verification.
- The repo's recent changes added a budget-policy schema/status function, but no founder-defined limits are seeded. Therefore no autonomous paid calls or spending are permitted.

## Pilot workflow

1. Founder submits a bounded objective: identify and qualify potential FK clients for the existing ₹21,000 entry engagement.
2. Reuse Founder Memory and Knowledge Vault first; same-brand facts may be reused, cross-brand figures must never be copied.
3. Use only the existing verified research capability for external fact-finding.
4. Produce a prospect evidence card: organisation, source URL/date, likely fit, observable trigger/need, evidence, confidence, missing information and disqualifiers.
5. Draft a tailored FK offer using the approved scope: business model/system design, SOPs, sales/CRM/lead systems, automation and franchise/dealer distribution as applicable. Do not promise delivery or outcomes not authorised by FK.
6. Create a founder review packet with proposed next action and draft message. No email, WhatsApp, call, social post, contract, invoice or payment action is executed.
7. If the founder later approves contact, a separate explicit approval and verified recipient/channel are required. This first pilot does not send anything.
8. Record the result and cost evidence. Count revenue only when a real payment/receipt record or other independently verifiable collection evidence exists—not leads, meetings, proposals, invoices or pipeline value.

## Safety boundaries

- No wallet, crypto, child-agent spawning, self-replication, self-deletion, bank access, autonomous transfer, ad spend, paid subscription or infrastructure purchase.
- No external outreach, bulk scraping, unsolicited messaging, contract acceptance, invoice sending or payment collection.
- No new paid model/provider calls unless the actual configured route and cost are visible and explicitly approved.
- No writes to production CRM, accounting or payment tables in this feasibility stage.
- Never invent a prospect, email, phone number, sales figure, payment or conversion.
- If data access, provider quota, source evidence or a capability is missing, return a clear blocked state rather than claiming success.

## Acceptance criteria

- [ ] Objective accepted through the existing founder-objective pipeline.
- [ ] Reuse-first search evidence is visible and correctly distinguishes same-brand data from cross-brand method-only reuse.
- [ ] Research sources are actually retrieved and cited.
- [ ] Each prospect has a traceable source, evidence-based fit rationale and confidence.
- [ ] Offer draft uses only approved FK terms and clearly marks assumptions.
- [ ] No external message or production business-data mutation occurs.
- [ ] Model/provider, token/cost and execution evidence are recorded where available.
- [ ] Independent verification rejects unsupported claims and fabricated outcomes.
- [ ] Founder can inspect and approve/reject the proposed next action.
- [ ] A later paid conversion is counted only from verified collection evidence.

## Immediate blockers to resolve before runtime

1. Confirm the production data source and schema for FK leads/brands/agreements and the actual read permissions. Do not infer access from table names or old dashboard snapshots.
2. Inspect the real lead discovery/ingestion engine interfaces before adding any capability to the registry.
3. Confirm which model resources are currently enabled, healthy and budgeted; do not assume historical API keys or credits still work.
4. Confirm whether an approved, current FK offer document exists in Knowledge Vault; ₹21,000 is the remembered entry fee, but scope/terms must be retrieved and checked before drafting an offer.
5. Run in a non-production environment or use read-only retrieval first. Live execution is not authorised by this document.

## First test case

Target: discover a small, source-backed shortlist of businesses that visibly appear to be suitable for FK's franchise/dealer system-building offer. Start with no more than five prospects. Return research and drafts only; founder decides whether to contact them.

## Current truth

This file records the inspected design and acceptance gates only. No objective was submitted, no live database was queried, no provider was called, no prospect was contacted, no money was spent, and no deployment was made.
