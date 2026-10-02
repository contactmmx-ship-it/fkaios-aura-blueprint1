# FKAIOS Workable System

This package removes the fake/local canned Brain fallback and routes Brain execution through the FKAIOS Resource Intelligence layer.

## Runtime requirements
- Node.js 20+
- `npm install`
- One provider key: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GROQ_API_KEY`
- Supabase variables required by the existing data modules

## Brain execution
`POST /api/brain` now:
1. Builds a reasoning task.
2. Enables only providers with configured credentials.
3. Selects a provider through FKAIOS Resource Intelligence.
4. Verifies the decision.
5. Executes only through a registered provider adapter.
6. Returns an explicit error when no real provider is configured.

There is deliberately no fake AI fallback.

## Resource status
`GET /api/resources` reports the provider catalog and which supported model providers have runtime credentials configured.

## Production integration
This package is prepared for deployment but has NOT been represented as the current live Vercel deployment. The connected environment does not expose a working source-write/deployment operation for the live GitHub repository.
