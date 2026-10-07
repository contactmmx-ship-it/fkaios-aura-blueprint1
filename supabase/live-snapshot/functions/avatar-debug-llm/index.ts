// DEPRECATED 2026-07-12 (Blueprint P2.4 cleanup). Debug function, neutered to
// 410 Gone with verify_jwt TRUE.
// FOUNDER: delete from Supabase dashboard — Claude has no delete tool.
Deno.serve(() => new Response(JSON.stringify({ error: "gone", detail: "avatar-debug-llm was removed 2026-07-12. See supabase/DRIFT.md." }), { status: 410, headers: { "Content-Type": "application/json" } }));
