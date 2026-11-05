-- Founder decisions, 5 Nov 2026 (founder said GO to make them part of FKAIOS).
-- Data only: no tables, columns or policies change. Reversible: set status back to
-- 'active' / is_active true, and active=false on the two principles.

-- 1. GoMax and Turning Point are dormant: left out of every plan, task and execution.
update public.brands set status = 'paused', is_active = false, updated_at = now()
 where name in ('GoMax', 'Turning Point');

update public.project_hub set status = 'paused', updated_at = now()
 where brand in ('GoMax', 'Turning Point');

-- 2. Two founder rules, read by ai-engine and the founder brain on every AI job.
insert into public.founder_principles (principle, category, applies_to, source, weight, active)
select v.principle, v.category, array['*'], v.source, 10, true
from (values
 ('DORMANT BRANDS: GoMax and Turning Point are on hold. Do not include them in any plan, task, objective, pilot, outreach, report, schedule or execution, and do not use their data as examples, until the founder reactivates them. If a request names one of them, say it is on hold and ask the founder before doing anything.',
  'founder_rule', 'Founder decision 2026-11-05 (dormant brands)'),
 ('WE DO OUR PART, WE DO NOT PROMISE RESULTS: Franchise Kart commits only to its own work. Every plan, proposal, deliverable and investor document states what FK will do: tasks, deliverables, timeline, price, who does what, and reporting. Never promise sales, revenue, growth or any client result. Revenue or result figures appear only as clearly labelled scenarios or targets. In client proposals do not write "no guarantee" or liability lines; simply list FK''s tasks and the client''s part.',
  'founder_rule', 'Founder decision 2026-11-05 (commit to work, not results)')
) as v(principle, category, source)
where not exists (select 1 from public.founder_principles p where p.source = v.source);
