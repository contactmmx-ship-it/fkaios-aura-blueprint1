import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return new Response("Product renderer is not configured.", { status: 503 });

  const endpoint = `${url}/functions/v1/products-public?build_id=${encodeURIComponent(id)}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  const body = await response.text();

  return new Response(body || (response.ok ? "<!doctype html><html><body><p>Product is empty.</p></body></html>" : "<!doctype html><html><body><p>Product unavailable.</p></body></html>"), {
    status: response.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-FKAIOS-Product-ID": id,
    },
  });
}
