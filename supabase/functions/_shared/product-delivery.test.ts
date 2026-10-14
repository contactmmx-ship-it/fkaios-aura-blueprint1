import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPublicProductUrl } from "./product-delivery.ts";

Deno.test("public product URL targets the public renderer and binds the exact build ID", () => {
  assertEquals(
    buildPublicProductUrl("https://nrlsqshkjuuwiovthrnb.supabase.co/", "d5d5013c-7361-4efc-adfa-bfba54ecd833"),
    "https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/products-public?build_id=d5d5013c-7361-4efc-adfa-bfba54ecd833",
  );
});

Deno.test("public product URL rejects insecure or malformed Supabase origins", () => {
  assertThrows(() => buildPublicProductUrl("http://example.supabase.co", "build-1"), Error, "HTTPS");
  assertThrows(() => buildPublicProductUrl("not-a-url", "build-1"), TypeError);
  assertThrows(() => buildPublicProductUrl("https://example.supabase.co", "  "), Error, "buildId");
});
