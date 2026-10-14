Deno.test("generated product route never injects a fabricated generic dashboard", async () => {
  const source = await Deno.readTextFile("src/app/product/[id]/route.ts");
  for (const fabricatedValue of [
    "function makeInteractive",
    "99.97%",
    "2,874",
    "4.1 TB",
    "Enterprise Suite",
    "Configuration is enabled for this demo workspace",
  ]) {
    if (source.includes(fabricatedValue)) {
      throw new Error("Generated product route contains fabricated demo content: " + fabricatedValue);
    }
  }
  if (!source.includes("return new Response(body")) {
    throw new Error("Generated product route must return the persisted renderer response, not replace it.");
  }
  if (!source.includes('"X-FKAIOS-Product-Renderer-Version": "2"')) {
    throw new Error("Product route must expose its renderer version so deployment checks can verify the correct page.");
  }
  if (!source.includes("Generated product HTML is missing or invalid")) {
    throw new Error("Missing generated HTML must fail visibly instead of falling back to demo content.");
  }
});
