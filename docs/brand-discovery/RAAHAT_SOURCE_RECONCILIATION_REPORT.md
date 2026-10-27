# Raahat Source Reconciliation Report

Status: source recovered and structurally extracted; semantic reconciliation and runtime mapping remain incomplete. This report is not release approval.

## Canonical source evidence

- Repository file: `docs/brand-discovery/source/RAAHAT_OWNER_DISCOVERY_QUESTIONNAIRE_ORIGINAL.txt`
- Source blob SHA: `4c8588b88885a049766ea47d22699c1889f7b478`
- Sections: 16
- Numbered question headings: 235
- Supporting-document checklist rows: 20
- Source contains section instructions, question-level instructions, checkbox options, subparts, checklist, confidentiality text, owner/date/signature fields, Franchise Kart sign-off, and next-step wording.

## Per-section comparison

| # | Source section | Source questions | Existing draft section | Draft questions |
|---:|---|---:|---|---:|
| 1 | THE OWNER AND HIS VISION | 15 | Owner and Vision | 15 |
| 2 | HISTORY, BRAND IDENTITY AND REPUTATION | 12 | History, Brand Identity and Reputation | 12 |
| 3 | COMPLETE BUSINESS AND SERVICE INVENTORY | 8 | Complete Business and Service Inventory | 7 |
| 4 | RESTAURANT, MENU AND FOOD QUALITY | 21 | Restaurant, Menu and Food Quality | 21 |
| 5 | HOTEL ROOMS AND GUEST EXPERIENCE | 15 | Hotel Rooms and Guest Experience | 15 |
| 6 | BANQUETS, EVENTS AND CATERING | 18 | Banquets, Events and Catering | 18 |
| 7 | CUSTOMERS, MARKET AND COMPETITION | 15 | Customers, Market and Competition | 15 |
| 8 | SALES, MARKETING AND DIGITAL PRESENCE | 16 | Sales, Marketing and Digital | 16 |
| 9 | FINANCIAL POSITION AND UNIT ECONOMICS | 20 | Financials and Unit Economics | 20 |
| 10 | PEOPLE, MANAGEMENT AND DAILY OPERATIONS | 17 | People, Management and Daily Operations | 17 |
| 11 | OWNER'S HONEST DIAGNOSIS: WHAT WENT WRONG? | 15 | Owner Diagnosis and What Went Wrong | 15 |
| 12 | FEARS, PAIN POINTS AND PERSONAL CONSTRAINTS | 14 | Fears, Pain and Constraints | 14 |
| 13 | SWOT: OWNER'S ASSESSMENT | 12 | SWOT | 12 |
| 14 | FUTURE AMBITION AND GROWTH | 12 | Future Ambition and Growth | 12 |
| 15 | FRANCHISE KART PARTNERSHIP AND AUTHORITY | 15 | Franchise Kart Partnership and Authority | 15 |
| 16 | IMMEDIATE PRIORITIES AND SUCCESS CRITERIA | 10 | Immediate Priorities and Success Criteria | 10 |

## Confirmed differences

- The source has 235 numbered question headings; the existing draft has 234 questions.
- Section 3 has 8 source questions; the existing draft has 7.
- Wording differs in multiple sections. Example: source Section 1, Question 1 asks about the owner's background and professional journey; the draft's first question asks for the owner's name and official role.
- The source checklist has 20 rows; the draft checklist has 14 entries.
- The replacement draft must not be activated.

## Release blockers

- Review every extracted question block, including selection instructions, answer options, subparts, ranges, and optional comments.
- Map each question to tested runtime controls. Some source questions have multiple subparts with different selection rules and must not be flattened into one choice group.
- Verify the checklist, declaration, confidentiality text, owner/date/signature fields, Franchise Kart sign-off and next-step wording.
- Run the fail-closed validator and CI after runtime mapping. Keep the template inactive until all checks pass.
- This work does not authorize production migration, deployment, email sending, or activation.
