-- FKAIOS golden evaluation suite fkaios_core v1 (mission 2026-10-08, docs/FKAIOS_AUTONOMY_ARCHITECTURE.md).
-- Fixed prompts with deterministic checks scored by code, never by the model
-- under test. Every case asks for JSON so scoring is exact. Bump suite_version
-- to change a case; old results stay comparable within their version.

set local lock_timeout = '5s';

insert into public.fkaios_eval_cases (suite, suite_version, case_key, task_class, system_prompt, prompt, checks) values
('fkaios_core', 1, 'reasoning_unit_price', 'reasoning',
 'Answer precisely. Return ONLY JSON.',
 'A shop sells pens at 3 for 45 rupees. How many rupees do 14 pens cost? Return {"answer": <number>}.',
 '[{"type":"json_number","path":"answer","value":210,"tolerance":0}]'),
('fkaios_core', 1, 'reasoning_ordering', 'reasoning',
 'Answer precisely. Return ONLY JSON.',
 'Ravi is older than Sita. Sita is older than Arun. Meena is older than Ravi. Who is the youngest, and who is the oldest? Return {"youngest": <name>, "oldest": <name>}.',
 '[{"type":"json_equals_ci","path":"youngest","value":"Arun"},{"type":"json_equals_ci","path":"oldest","value":"Meena"}]'),
('fkaios_core', 1, 'extraction_invoice', 'extraction',
 'Extract exactly what is in the text. Never invent values. Return ONLY JSON.',
 'Text: "Invoice FK-2291 issued to Gio Paints on 3 Sep 2026. Subtotal INR 40,000; GST 18% INR 7,200; total payable INR 47,200 by 30 Sep 2026." Return {"invoice_number": string, "customer": string, "total_inr": number, "due_date": "YYYY-MM-DD"}.',
 '[{"type":"json_equals_ci","path":"invoice_number","value":"FK-2291"},{"type":"json_equals_ci","path":"customer","value":"Gio Paints"},{"type":"json_number","path":"total_inr","value":47200,"tolerance":0},{"type":"json_equals_ci","path":"due_date","value":"2026-09-30"}]'),
('fkaios_core', 1, 'extraction_emails', 'extraction',
 'Extract exactly what is in the text. Return ONLY JSON.',
 'Text: "Contact sales@gomax.in for orders, or ops@giopaints.com. Do not use old-team@gomax.in (closed). Press: media@franchisekart.in". Return {"active_emails": [strings]} listing only active addresses, in the order they appear.',
 '[{"type":"json_array_equals_ci","path":"active_emails","value":["sales@gomax.in","ops@giopaints.com","media@franchisekart.in"]}]'),
('fkaios_core', 1, 'planning_ordered_steps', 'planning',
 'You are a planner. Return ONLY JSON.',
 'Objective: publish a one-page franchise enquiry website for GoMax with a working enquiry form. Return {"steps": [strings]} with 4 to 6 ordered steps. The first step must be about requirements or content, and one step must test the enquiry form.',
 '[{"type":"json_array_len","path":"steps","min":4,"max":6},{"type":"json_array_item_matches","path":"steps","index":0,"pattern":"requirement|content|scope|copy"},{"type":"json_array_any_matches","path":"steps","pattern":"test.*form|form.*test|verify.*form|form.*submi"}]'),
('fkaios_core', 1, 'writing_constrained_summary', 'writing',
 'Write clearly. Return ONLY JSON.',
 'Summarise in at most 40 words, in exactly two sentences, mentioning the number 12 and the word franchise: "GoMax opened 12 new franchise outlets this quarter across Maharashtra and Gujarat. Average setup time fell from 9 weeks to 6 weeks because standard fit-out kits were introduced. Two outlets are delayed by permits." Return {"summary": string}.',
 '[{"type":"json_max_words","path":"summary","max":40},{"type":"json_contains_all_ci","path":"summary","values":["12","franchise"]},{"type":"json_sentence_count","path":"summary","value":2}]'),
('fkaios_core', 1, 'verification_claims', 'verification',
 'Judge each claim strictly against the source. Return ONLY JSON.',
 'Source: "FKAIOS policy: AI agents never move money. Any irreversible action requires founder approval. Agents may draft proposals but may not send them without approval." Claims: (1) Agents may transfer money for approved invoices. (2) Irreversible actions need founder approval. (3) Agents may draft proposals. (4) Agents may send proposals without approval. Return {"supported": [boolean, boolean, boolean, boolean]}.',
 '[{"type":"json_array_equals_ci","path":"supported","value":[false,true,true,false]}]'),
('fkaios_core', 1, 'coding_trace', 'coding',
 'You are a precise programmer. Return ONLY JSON.',
 'What does this JavaScript print? const xs=[3,8,5,12,7]; let s=0; for (const x of xs) { if (x % 2 === 0) s += x; else s -= 1; } console.log(s); Return {"output": <number>}.',
 '[{"type":"json_number","path":"output","value":17,"tolerance":0}]')
on conflict (suite, suite_version, case_key) do nothing;
