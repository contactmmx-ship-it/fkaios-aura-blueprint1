# Brand discovery security test matrix (not yet executed)

| Case | Expected result |
|---|---|
| Missing, malformed, or unknown resume token | 401; no session or answer data |
| Expired resume token | 410; no session or answer data |
| Token with submitted session | reads allowed only for that session; save/submit rejected |
| Question ID not present in that questionnaire version | 400; no write |
| Save valid answer, then reload with same token | saved answer and exact section/question pointer returned |
| Submit while required answers are missing | 422 with missing count only |
| Submit after all required answers | submitted state persisted |
| FK invite without a valid JWT | 401 |
| FK invite with valid JWT but email absent from allowlist | 403 |
| Invite for a non-active questionnaire version | 400 |
| Respondent read request | must never include private report fields or execution plan |
| Browser bundle inspection | must not contain the service-role key |
| CORS preflight | only configured origin is allowed in production |
| Missing question objects in draft Raahat JSON | 503 questionnaire_not_ready; no invented questions served |

## Status
These are acceptance criteria, not test results. The migration and functions remain in the feature branch and have not been deployed. Before release, automate this matrix against a non-production environment and inspect logs for token leakage.
