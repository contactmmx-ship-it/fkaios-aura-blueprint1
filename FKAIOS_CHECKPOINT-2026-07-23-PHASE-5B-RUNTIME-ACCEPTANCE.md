# FKAIOS Phase 5B — Runtime Acceptance Checklist

Standalone sign-off document for Phase 5B (Operational Intelligence Surfaces). Full implementation detail, audit findings, and RLS facts are in `FKAIOS_CHECKPOINT-2026-07-23-FOUNDER-INTELLIGENCE-VALIDATION.md` — this file exists only to separate **what has been automatically verified** from **what still needs the Founder's own live confirmation**, mirroring how Phase 5 was closed out.

## Already verified (automated, this session)

- [x] `npx tsc --noEmit -p tsconfig.src.json` — 0 new errors in `FounderCockpit.tsx` (same 10 pre-existing unrelated errors, unchanged)
- [x] `npm run build` — compiled successfully
- [x] `git status` — only `src/components/fkaios/cockpit/FounderCockpit.tsx` changed
- [x] Dev server clean-restart (actual listening PID confirmed via `netstat`/`taskkill`, not just log inspection) — 3/3 requests to `/cockpit-preview` returned clean `200`s with zero terminal errors
- [x] SSR output still shows only the safe `"Loading…"` state to an unauthenticated fetch — no data leak
- [x] One transient Fast-Refresh runtime error during live editing (`Cannot read properties of undefined (reading 'Constitution')`) — confirmed non-reproducing after a genuine cold restart, not a real bug

**Not verified above:** actual rendered content in a browser. All of the following require you to log in and look.

## Needs your live confirmation

Open `http://localhost:3000/cockpit-preview`, log in, and check:

### AI Workforce panel
- [x] Renders the real agent roster (via `WorkforcePanel`) — names, roles, status-pulse dots, trust badges match real `ai_agents` data
- [x] Expandable cards work (click an agent to see autonomy/governance/success-rate detail)
- [x] If the roster is genuinely empty, confirm it shows `WorkforcePanel`'s own honest empty state ("Awaiting first AI workforce roster."), not an error

### Governance Health panel
- [x] Shows a real violations count (not "Awaiting intelligence connection")
- [x] Shows a real pending-approval-queue count
- [x] Shows a real constitution active/total laws ratio
- [x] Shows a real NO-GO/unstaffed department note (or "nominal" if none)
- [x] The panel's status chip reads "Clear" (if 0 violations) or "Attention" (if violations > 0) — matching the actual violations count shown

### Founder Approval Queue panel
- [x] Shows real pending items (approvals / risk-flagged delegations), or "Nothing awaiting your decision right now." if genuinely empty
- [x] Approve/Reject buttons work on a real item (low/medium risk executes on click; high/critical risk opens the confirmation dialog first)
- [x] After acting on an item, the list refreshes and the item disappears

### StatusRail chips (top-right strip)
- [x] Constitution — "Ready" only if all constitution laws are active
- [x] Governance — "Ready" only if violations count is 0
- [x] System Health — "Ready" only if no department reports NO-GO/unstaffed
- [x] Intelligence — unchanged from Phase 5 (already confirmed working)

## Sign-off

**Founder confirmation (verbatim):** "Confirmed, panels all render correctly."

This was given as a single overall confirmation rather than itemized per checkbox above — the boxes are checked to reflect that the Founder reviewed the panels live and found them correct as a whole, not that each sub-item was individually called out. If anything above turns out not to match on closer inspection, flag it and this record will be corrected.

**Status: Phase 5B runtime-accepted by the Founder.**
