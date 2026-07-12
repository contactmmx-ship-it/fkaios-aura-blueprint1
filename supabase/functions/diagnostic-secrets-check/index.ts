// DEPRECATED 2026-07-12 (Blueprint P1.5 / P2.4 cleanup).
// This was a one-time debug function that publicly enumerated which platform
// secrets exist (verify_jwt was false) — a reconnaissance surface. It has been
// neutered: verify_jwt is now TRUE and the body returns 410 Gone.
// FOUNDER: delete this function from the Supabase dashboard (Edge Functions →
// diagnostic-secrets-check → Delete). Claude has no tool to delete functions.
Deno.serve(() => new Response(JSON.stringify({ error: "gone", detail: "diagnostic-secrets-check was removed 2026-07-12. See supabase/DRIFT.md." }), { status: 410, headers: { "Content-Type": "application/json" } }));
