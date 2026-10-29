-- FKAIOS golden suite fkaios_core v2: at least three cases per task class.
--
-- Why: v1 had ONE case each for coding, planning, verification and writing.
-- A one-case class compares 0 vs 100 on a single answer, which is how eight
-- adoption proposals on 9-10 Oct all showed "100% improvement" (every Gemini
-- candidate got coding_trace right; the incumbent gemini-3.5-flash-lite got it
-- wrong). The minimum-evidence gate added afterwards requires 3 paired cases
-- per class, so with v1 no candidate could ever qualify in those classes.
-- v2 keeps the 8 v1 cases unchanged and adds 10, giving 3 per class.
-- Every expected value below was worked out by hand and is deterministic.

insert into public.fkaios_eval_cases (suite, suite_version, case_key, task_class, system_prompt, prompt, checks, weight, active)
select suite, 2, case_key, task_class, system_prompt, prompt, checks, weight, true
from public.fkaios_eval_cases
where suite = 'fkaios_core' and suite_version = 1
on conflict (suite, suite_version, case_key) do nothing;

insert into public.fkaios_eval_cases (suite, suite_version, case_key, task_class, system_prompt, prompt, checks) values
-- reasoning (3rd): 6% of 8,50,000 = 51,000
('fkaios_core', 2, 'reasoning_royalty', 'reasoning',
 'Answer precisely. Return ONLY JSON.',
 'A franchisee pays a 6% royalty on monthly sales. Sales this month were INR 8,50,000 (Indian number format). What is the royalty in rupees? Return {"royalty_inr": <number>}.',
 '[{"type":"json_number","path":"royalty_inr","value":51000,"tolerance":0}]'::jsonb),
-- extraction (3rd)
('fkaios_core', 2, 'extraction_lead', 'extraction',
 'Extract exactly what is in the text. Never invent values. Return ONLY JSON.',
 'Text: "Hi, I am Pooja Sharma from Panipat, call me on 98120 45567. Interested in a Chaat Masters franchise, budget around 15 lakh." Return {"name": string, "city": string, "phone_digits": string (10 digits, no spaces), "budget_inr": number}.',
 '[{"type":"json_equals_ci","path":"name","value":"Pooja Sharma"},{"type":"json_equals_ci","path":"city","value":"Panipat"},{"type":"json_equals_ci","path":"phone_digits","value":"9812045567"},{"type":"json_number","path":"budget_inr","value":1500000,"tolerance":0}]'::jsonb),
-- coding (2nd): 20,30,40,50 -> 2+3+4+5 = 14
('fkaios_core', 2, 'coding_chain', 'coding',
 'You are a precise programmer. Return ONLY JSON.',
 'What does this JavaScript print? console.log([10,20,30,40,50].filter(x => x > 15).map(x => x / 10).reduce((a, b) => a + b, 0)); Return {"output": <number>}.',
 '[{"type":"json_number","path":"output","value":14,"tolerance":0}]'::jsonb),
-- coding (3rd): loop starts at index 1, so f([2,4,6]) = 4 + 6 = 10; bug on line 3
('fkaios_core', 2, 'coding_bug_line', 'coding',
 'You are a precise programmer. Return ONLY JSON.',
 E'This Python function should return the sum of the even numbers in a list.\n1: def f(xs):\n2:     t = 0\n3:     for i in range(1, len(xs)):\n4:         if xs[i] % 2 == 0: t += xs[i]\n5:     return t\nWhat does f([2, 4, 6]) return as written, and which numbered line has the bug? Return {"returns": <number>, "bug_line": <number>}.',
 '[{"type":"json_number","path":"returns","value":10,"tolerance":0},{"type":"json_number","path":"bug_line","value":3,"tolerance":0}]'::jsonb),
-- planning (2nd)
('fkaios_core', 2, 'planning_dealer_onboarding', 'planning',
 'You are a planner. Return ONLY JSON.',
 'Objective: onboard a new paint dealer in Karnal onto the GoMax loyalty app. Return {"steps": [strings]} with 3 to 6 ordered steps. One step must collect the dealer''s KYC, and one step must confirm the dealer''s first QR coupon scan worked.',
 '[{"type":"json_array_len","path":"steps","min":3,"max":6},{"type":"json_array_any_matches","path":"steps","pattern":"kyc|pan|gst"},{"type":"json_array_any_matches","path":"steps","pattern":"scan|qr"}]'::jsonb),
-- planning (3rd)
('fkaios_core', 2, 'planning_menu_launch', 'planning',
 'You are a planner. Return ONLY JSON.',
 'Objective: launch a new chaat item across 5 Chaat Masters outlets within two weeks. Return {"steps": [strings]} with 4 to 7 ordered steps. The first step must fix the recipe or standard (SOP), one step must train outlet staff, and one step must track sales or customer feedback after launch.',
 '[{"type":"json_array_len","path":"steps","min":4,"max":7},{"type":"json_array_item_matches","path":"steps","index":0,"pattern":"recipe|sop|standard|portion"},{"type":"json_array_any_matches","path":"steps","pattern":"train"},{"type":"json_array_any_matches","path":"steps","pattern":"feedback|sales|track|review"}]'::jsonb),
-- verification (2nd)
('fkaios_core', 2, 'verification_invoice_claims', 'verification',
 'Judge each claim strictly against the source. Return ONLY JSON.',
 'Source: "Invoice FK-3105 to Arofur: subtotal INR 50,000; GST 18% INR 9,000; total INR 59,000; due 15 Nov 2026; payment by bank transfer only." Claims: (1) The total is INR 59,000. (2) GST is charged at 12%. (3) Cash payment is accepted. (4) The invoice is due on 15 Nov 2026. Return {"supported": [boolean, boolean, boolean, boolean]}.',
 '[{"type":"json_array_equals_ci","path":"supported","value":[true,false,false,true]}]'::jsonb),
-- verification (3rd): 1550 - 1240 = 310; 3.1 lakh is not 31 lakh; Karnal is not Panipat
('fkaios_core', 2, 'verification_sales_claims', 'verification',
 'Judge each claim strictly against the source. Return ONLY JSON.',
 'Source: "Mr. Chick''n Karnal sold 1,240 meals in September and 1,550 meals in October. October revenue was INR 3.1 lakh." Claims: (1) October meal sales were higher than September. (2) Meal sales rose by 310 from September to October. (3) October revenue was INR 31 lakh. (4) The outlet is in Panipat. Return {"supported": [boolean, boolean, boolean, boolean]}.',
 '[{"type":"json_array_equals_ci","path":"supported","value":[true,true,false,false]}]'::jsonb),
-- writing (2nd)
('fkaios_core', 2, 'writing_payment_reminder', 'writing',
 'Write clearly. Return ONLY JSON.',
 'Write a polite WhatsApp payment reminder to a dealer in at most 35 words and exactly two sentences. Mention invoice FK-2291 and write the amount exactly as INR 47,200. Return {"message": string}.',
 '[{"type":"json_max_words","path":"message","max":35},{"type":"json_contains_all_ci","path":"message","values":["FK-2291","INR 47,200"]},{"type":"json_sentence_count","path":"message","value":2}]'::jsonb),
-- writing (3rd)
('fkaios_core', 2, 'writing_headline', 'writing',
 'Write clearly. Return ONLY JSON.',
 'Write one headline of at most 10 words inviting franchise partners for Gio Paints in Haryana. It must contain the words "Gio Paints" and "franchise". Return {"headline": string}.',
 '[{"type":"json_max_words","path":"headline","max":10},{"type":"json_contains_all_ci","path":"headline","values":["gio paints","franchise"]}]'::jsonb)
on conflict (suite, suite_version, case_key) do nothing;

-- The evaluator picks the highest active version; v1 stays for history only.
update public.fkaios_eval_cases set active = false where suite = 'fkaios_core' and suite_version = 1;

-- Retire the eight single-case proposals from 9-10 Oct. Each rests on one
-- coding answer (confidence 25%), below the 3-case minimum, so the evaluator
-- holds them forever and they only clutter the founder's approval queue.
-- This is not a verdict on the models: the candidates go back to 'eligible'
-- so they are re-tested on suite v2.
with stale as (
  select id, approval_id, candidate_resource_key
  from public.capability_adoption_proposals
  where recommendation = 'candidate' and benchmark_suite = 'fkaios_core@1' and coalesce(confidence_pct, 0) < 75
)
update public.approvals a
   set status = 'expired', decided_by = 'policy:min_evidence_gate_v1', decided_at = now()
  from stale
 where a.id = stale.approval_id and a.status = 'pending';

update public.capability_adoption_proposals
   set recommendation = 'rejected', decided_by = 'policy:min_evidence_gate_v1', decided_at = now(),
       evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object('retired_reason', 'single-case evidence on fkaios_core@1 (below the 3-case minimum); candidate re-queued for fkaios_core@2')
 where recommendation = 'candidate' and benchmark_suite = 'fkaios_core@1' and coalesce(confidence_pct, 0) < 75;

-- Every candidate verified on v1 is re-tested on v2. Only the candidate row
-- changes; model_registry keeps lifecycle 'verified', so production routing
-- and fallbacks are untouched while the re-test runs. Capability discovery
-- re-queues them because their last evaluation was on an older suite version.
update public.capability_discovery_candidates
   set status = 'eligible'
 where status = 'verified' and candidate_type = 'model';
