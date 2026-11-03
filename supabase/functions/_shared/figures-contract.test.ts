import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FIGURES_CONTRACT, figuresContract } from "./figures-contract.ts";

Deno.test("figures contract applies only to objective work", () => {
  assertEquals(figuresContract(undefined), "");
  assertEquals(figuresContract({}), "");
  assertEquals(figuresContract({ objective_id: "" }), "");
  assertEquals(figuresContract({ objective_id: "2cceed20-e4c6-4adf-b5c6-00a2c9f4ebf6" }), FIGURES_CONTRACT);
});

Deno.test("figures contract states the three allowed origins and the do-not-use rule", () => {
  for (const phrase of ["SOURCE:", "FOUNDER-STATED:", "ASSUMPTION:", "(founder-stated, unverified)", "\"unknown\"", "must not be used", "open issues"]) {
    assert(FIGURES_CONTRACT.includes(phrase), `missing: ${phrase}`);
  }
});
