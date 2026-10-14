import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return new Response("Product renderer is not configured.", { status: 503 });

  const endpoint = `${url}/functions/v1/products-public?build_id=${encodeURIComponent(id)}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  const body = await response.text();

  // Never decorate or replace generated product content with a generic demo UI.
  // The renderer's job is to return the exact HTML persisted for this build ID.
  // A missing/non-HTML response is a failure, not a successful product page.
  if (response.ok && (!body.trim() || !/<html[\s>]/i.test(body))) {
    return new Response("Generated product HTML is missing or invalid; no demo dashboard was substituted.", {
      status: 502,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-FKAIOS-Product-ID": id,
        "X-FKAIOS-Product-Renderer-Version": "2",
      },
    });
  }

  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-FKAIOS-Product-ID": id,
        "X-FKAIOS-Product-Renderer-Version": "2",
    },
  });
}
