# How AI tools must work in this repo (FKAIOS)

Read this before changing anything. It applies to every AI tool (Claude, ChatGPT/Codex, Cursor, Gemini, others).

## Founder rules (Rajeev Arora)
1. **Reuse before build.** Check this repo and existing tables first. If it works, reuse it. If broken, repair it.
   If missing, find an open-source repo, model or API and build it in. Write new code only for what is genuinely missing, and say why.
2. **Never change what already works.** New work goes on a branch and a pull request. Nothing is merged or deployed unless the tests pass.
3. **Done = proof.** A test passed or a live call worked, with evidence. "Code written" is not done.
4. **No paid AI, API or service without approval.** No new database tables or columns without approval.
5. **This repo is PUBLIC.** Never put client names, client figures, secrets or tokens in code, tests or docs. Use made-up data (e.g. "Acme", "₹12 lakh").
6. Do not bypass CI, deploy functions by hand to production, delete data, or modify FKAIOS while a test objective is running.
7. At the end of a work session, update the FK HANDOFF file (current state + next steps).

## Coding discipline
(Our wording of widely shared practice for coding agents, e.g. Andrej Karpathy's public notes on LLM coding mistakes.)
- **Think before coding.** State your assumptions. If the request can be read two ways, ask or pick the safer reading and say so.
- **Keep it simple.** Write the minimum code that solves the task. No speculative features or one-use abstractions.
- **Surgical changes.** Touch only what the task needs. Match the existing style. No unrelated refactors.
- **Work to a verifiable goal.** Turn the task into a check (a failing test that then passes, a live call that returns the right thing) before you say it is done.

## Skills ("hands")
Skills live in `supabase/functions/_shared/skills/` with a test next to each. A skill wraps an existing open-source library
where possible (licence MIT/Apache/BSD only — never copy GPL/AGPL code). Each skill is registered in `capability_registry` after a live test.
- `excel.ts` — make a real .xlsx from a JSON spec (ExcelJS, MIT). Live endpoint: `skill-excel`.
