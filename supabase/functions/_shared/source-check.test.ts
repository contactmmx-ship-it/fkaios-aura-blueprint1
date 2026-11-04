import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { attributedNames, checkDeliverableSources, extractFigures, matchSource, type CheckedSource } from "./source-check.ts";

// Synthetic fixtures only (public repo: no client data).
const REGISTER: CheckedSource = { id: "s1", title: "Register: X01 · Acme — distribution and fees", text: "Acme fee dispute ~₹2.1 L. Scheme: 12% trade discount, 3 free per 40 bags. Sales ₹20–25 lakh across 2 states." };
const PLAYBOOK: CheckedSource = { id: "s2", title: "Drive: Generic Sales Playbook v1.0 (playbook.docx)", text: "Daily rhythm: 20 calls, 8 meetings. Acme is mentioned once here." };
const OTHER: CheckedSource = { id: "s3", title: "ChatGPT: Paint Distribution Strategy (2026-07-20)", text: "Zenith Paints dealers. Credit limits: Platinum ₹5,00,000, Gold ₹2,00,000." };
const BROCHURE: CheckedSource = { id: "s4", title: "ChatGPT: Festive Bonanza Scheme (2026-08-05)", text: "Slabs ₹7L to ₹18L with gifts." };
const SOURCES = [REGISTER, PLAYBOOK, OTHER, BROCHURE];
const OTHERS = ["Zenith Paints", "Bistro Masters"];
const OBJECTIVE = "Acme growth plan. Approximate position: sales ₹22–24 lakh/month, 9-person sales team.";

Deno.test("figures: money, ranges, lakh, k, % and counts; dates, ids and durations ignored", () => {
  const f = extractFigures("₹2.1 L dues, ₹20–25 lakh sales, 12% TD, ₹25–30k fee, 40 bags, P08, 2026-10-02, 90 days, Day 30, FY26");
  const vals = f.map((x) => x.values);
  assertEquals(vals, [[210000], [2000000, 2500000], [12], [25000, 30000], [40]]);
  assert(f[2].pct);
});

Deno.test("attributions and title matching", () => {
  assertEquals(attributedNames("Dues ₹2.1 L (Source: Register: X01 · Acme; Drive: Generic Sales Playbook v1.0)."), ["Register: X01 · Acme", "Drive: Generic Sales Playbook v1.0"]);
  assertEquals(matchSource("Register: X01 · Acme", SOURCES)?.id, "s1");
  assertEquals(matchSource("ChatGPT: Paint Distribution Strategy", SOURCES)?.id, "s3");
  assertEquals(matchSource("Something Else Entirely", SOURCES), null);
});

Deno.test("a figure that is in its cited source passes", () => {
  const r = checkDeliverableSources({ deliverable: "- Fee dispute ~₹2.1 L; scheme 12% TD and 3 free per 40 bags (Source: Register: X01 · Acme).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: ["Acme"] });
  assertEquals(r.issues, []);
  assert(r.checkedFigures >= 3);
});

Deno.test("a figure credited to a source that does not contain it is flagged", () => {
  const r = checkDeliverableSources({ deliverable: "- Team: 1 head, 3 managers, 10 executives = 14 people (Source: Drive: Generic Sales Playbook v1.0).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: ["Acme"] });
  assert(r.issues.some((i) => i.includes('"14"') && i.includes("does not contain")), r.issues.join("\n"));
});

Deno.test("a founder-stated figure credited to a document is a mis-attribution", () => {
  const r = checkDeliverableSources({ deliverable: "- Sales: ₹22–24 lakh/month (Founder-stated, unverified; source: Drive: Generic Sales Playbook v1.0).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: ["Acme"] });
  assert(r.issues.some((i) => i.includes("comes from the founder's objective")), r.issues.join("\n"));
});

Deno.test("a founder-stated figure without a source, and assumptions, are not checked here", () => {
  const r = checkDeliverableSources({ deliverable: "- Sales: ₹22–24 lakh/month (founder-stated, unverified).\n- Month 2 sales ₹30 lakh (Assumption: 25% growth; source: Register: X01 · Acme).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: ["Acme"] });
  assertEquals(r.issues, []);
});

Deno.test("another brand's source and a never-retrieved source are flagged", () => {
  const r = checkDeliverableSources({ deliverable: "- Credit limits Platinum ₹5,00,000 (Source: ChatGPT: Paint Distribution Strategy).\n- Collection efficiency 85% (Source: Imaginary Report 2026).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: ["Acme"], otherBrands: OTHERS });
  assert(r.issues.some((i) => i.includes("is about Zenith Paints, not Acme")), r.issues.join("\n"));
  assert(r.issues.some((i) => i.includes("never retrieved")), r.issues.join("\n"));
});

Deno.test("with web research present, unmatched source names are left to the URL rules", () => {
  const r = checkDeliverableSources({ deliverable: "- Market size 40% (Source: Some Industry Report).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: [], hasWebSources: true });
  assertEquals(r.issues, []);
});

Deno.test("a source that names no brand (a scheme brochure chat) is not a brand problem", () => {
  const r = checkDeliverableSources({ deliverable: "- Festive slabs ₹7L to ₹18L (Source: ChatGPT: Festive Bonanza Scheme).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: ["Acme"], otherBrands: OTHERS });
  assertEquals(r.issues, []);
});

Deno.test("durations written as 90-day are not figures; repeated source titles are named once (run 5, 3 Nov 2026)", () => {
  assertEquals(extractFigures("a 90-day roadmap, 12-month view, 3-week sprint").length, 0);
  const r = checkDeliverableSources({ deliverable: "- A 90-day plan to reach 14 people (Source: Register: X01 · Acme, p.2; Register: X01 · Acme, p.3).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: ["Acme"] });
  assertEquals(r.issues.length, 1);
  assertEquals(r.issues[0].split("Register: X01").length - 1, 1);
});

Deno.test("ageing buckets are not figures; an unlabelled objective figure is told to be founder-stated (run 5, 4 Nov 2026)", () => {
  assertEquals(extractFigures("Audit ledgers into 0-30, 31-60, 61-90, and 90+ days overdue buckets").length, 0);
  const r = checkDeliverableSources({ deliverable: "- Baseline sales ₹22–24 lakh per month (Source: Drive: Generic Sales Playbook v1.0).", objectiveText: OBJECTIVE, sources: SOURCES, targetBrands: ["Acme"] });
  assertEquals(r.issues.length, 1);
  assert(r.issues[0].includes("(founder-stated, unverified)"), r.issues[0]);
});
