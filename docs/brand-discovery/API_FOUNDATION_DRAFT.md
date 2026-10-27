# Brand Discovery API foundation — draft

This work is isolated on `feature/brand-discovery-foundation` and is not deployed.

## Security design
- Respondent resume links use high-entropy random tokens; only a SHA-256 hash is stored.
- Respondent routes must never return FK private analysis or execution plans.
- Invite creation must require a verified Supabase user JWT and an explicit FK staff email allowlist.
- The Supabase service key must remain server-side and must never be exposed to a browser.
- Configure an exact allowed web origin; do not use a wildcard in production.

## Release gates
- Recover the original question wording and encode all questions in the versioned questionnaire.
- Implement and test invite creation, secure save/restore, submit completeness, and expiry.
- Configure email only after approving a provider and sending policy.
- Add integration tests for wrong/expired tokens, staff allowlist rejection, respondent/private-report separation, and CORS.
- Do not apply the database migration or deploy functions until review and explicit release approval.

No email, paid AI, production database change, or deployment is part of this draft.