import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isVerifiedProductRenderer } from "./product-delivery.ts";

const buildId = "build-123";
const goodHeaders = () => new Headers({
  "content-type": "text/html; charset=utf-8",
  "x-fkaios-product-id": buildId,
  "x-fkaios-product-renderer-version": "2",
});

Deno.test("renderer evidence accepts only the exact generated HTML page", () => {
  assertEquals(isVerifiedProductRenderer({
    status: 200,
    headers: goodHeaders(),
    buildId,
    html: "<!doctype html><html><head></head><body>Real generated page</body></html>",
  }), true);
});

Deno.test("renderer evidence rejects the public Supabase text/plain sandbox response", () => {
  const headers = new Headers({
    "content-type": "text/plain",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-fkaios-product-id": buildId,
    "x-fkaios-product-renderer-version": "2",
  });
  assertEquals(isVerifiedProductRenderer({
    status: 200,
    headers,
    buildId,
    html: "<!doctype html><html><body>HTML source, not a rendered product</body></html>",
  }), false);
});

Deno.test("renderer evidence rejects redirects, mismatched builds, missing version, and non-HTML", () => {
  assertEquals(isVerifiedProductRenderer({ status: 302, headers: goodHeaders(), buildId, html: "<html></html>" }), false);
  const wrongId = goodHeaders(); wrongId.set("x-fkaios-product-id", "other-build");
  assertEquals(isVerifiedProductRenderer({ status: 200, headers: wrongId, buildId, html: "<html></html>" }), false);
  const oldVersion = goodHeaders(); oldVersion.delete("x-fkaios-product-renderer-version");
  assertEquals(isVerifiedProductRenderer({ status: 200, headers: oldVersion, buildId, html: "<html></html>" }), false);
  const jsonHeaders = goodHeaders(); jsonHeaders.set("content-type", "application/json");
  assertEquals(isVerifiedProductRenderer({ status: 200, headers: jsonHeaders, buildId, html: "<html></html>" }), false);
  assertEquals(isVerifiedProductRenderer({ status: 200, headers: goodHeaders(), buildId, html: "not HTML" }), false);
});
