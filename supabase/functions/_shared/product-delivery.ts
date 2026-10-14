export interface ProductRendererProbe {
  status: number;
  headers: Headers;
  buildId: string;
  html: string;
}

/** A product is live only when the configured renderer serves this exact build as HTML. */
export function isVerifiedProductRenderer(probe: ProductRendererProbe): boolean {
  if (!probe.buildId.trim()) return false;
  const contentType = probe.headers.get("content-type") ?? "";
  const productId = probe.headers.get("x-fkaios-product-id") ?? "";
  const rendererVersion = Number(probe.headers.get("x-fkaios-product-renderer-version"));
  return probe.status >= 200 &&
    probe.status < 300 &&
    contentType.toLowerCase().includes("text/html") &&
    productId === probe.buildId &&
    rendererVersion === 2 &&
    /<html[\s>]/i.test(probe.html);
}
