import { assertEquals } from "jsr:@std/assert@1";
import { authenticateCaller, bearerToken, timingSafeEqual } from "./internal-auth.ts";

const SECRET = "sb_secret_test_key_value";
const LEGACY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
const USER_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.validsig";
// A token that *claims* service_role but is not one of our keys.
const FORGED = "eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x";

let getUserCalls = 0;
const deps = {
  serviceKeys: [SECRET, undefined, ""],
  getUser: (token: string) => {
    getUserCalls++;
    return Promise.resolve(token === USER_JWT ? { id: "user-1" } : null);
  },
};

Deno.test("internal-auth: missing credential is rejected", async () => {
  const r = await authenticateCaller(null, deps);
  assertEquals(r.ok, false);
  const r2 = await authenticateCaller("Basic abc", deps);
  assertEquals(r2.ok, false);
});

Deno.test("internal-auth: modern secret key is a service caller", async () => {
  const r = await authenticateCaller(`Bearer ${SECRET}`, deps);
  assertEquals(r, { ok: true, caller: { kind: "service" } });
});

Deno.test("internal-auth: legacy JWT service key is a service caller when it is the configured key", async () => {
  const r = await authenticateCaller(`Bearer ${LEGACY}`, { ...deps, serviceKeys: [LEGACY] });
  assertEquals(r, { ok: true, caller: { kind: "service" } });
});

Deno.test("internal-auth: a token claiming service_role is NOT trusted by its claims", async () => {
  const r = await authenticateCaller(`Bearer ${FORGED}`, deps);
  assertEquals(r.ok, false);
});

Deno.test("internal-auth: malformed non-key token is rejected without calling Auth", async () => {
  getUserCalls = 0;
  const r = await authenticateCaller("Bearer sb_secret_wrong", deps);
  assertEquals(r.ok, false);
  assertEquals(getUserCalls, 0);
});

Deno.test("internal-auth: valid user token is a user caller", async () => {
  const r = await authenticateCaller(`Bearer ${USER_JWT}`, deps);
  assertEquals(r, { ok: true, caller: { kind: "user", userId: "user-1", token: USER_JWT } });
});

Deno.test("internal-auth: expired or revoked user token (Auth says no) is rejected", async () => {
  const r = await authenticateCaller("Bearer a.b.c", deps);
  assertEquals(r.ok, false);
  const throwing = { ...deps, getUser: () => Promise.reject(new Error("network")) };
  const r2 = await authenticateCaller(`Bearer ${USER_JWT}`, throwing);
  assertEquals(r2.ok, false);
});

Deno.test("internal-auth: helpers", () => {
  assertEquals(bearerToken("Bearer  x.y.z "), "x.y.z");
  assertEquals(bearerToken("bearer abc"), "abc");
  assertEquals(bearerToken(""), null);
  assertEquals(timingSafeEqual("abc", "abc"), true);
  assertEquals(timingSafeEqual("abc", "abd"), false);
  assertEquals(timingSafeEqual("abc", "abcd"), false);
});
