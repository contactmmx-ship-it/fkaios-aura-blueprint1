// Tests for selectBestEmployee() — the one real worker-selection
// implementation in this codebase (see
// FKAIOS_KERNEL_CONSOLIDATION_PHASE1_DEPENDENCY_GRAPH.md, question 3).
// Previously untested. Pure function: department filter -> active/online
// filter -> lowest active-job-count wins -> highest success-rate breaks
// ties. No DB access, so no env-var setup is strictly required, but the
// module is still imported dynamically to match this repo's established
// convention for _shared files that (elsewhere in the same file) call
// createClient() at call time.

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const { selectBestEmployee } = await import("./work-engine.ts");
type EmployeeSummary = Parameters<typeof selectBestEmployee>[0][number];

function employee(overrides: Partial<EmployeeSummary> & { id: string }): EmployeeSummary {
  return {
    name: overrides.id,
    department: null,
    status: "active",
    isActive: true,
    autonomyLevel: null,
    successRate: null,
    totalTasksCompleted: null,
    lastActiveAt: null,
    activeJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    ...overrides,
  };
}

Deno.test("selectBestEmployee: returns null for an empty workforce", () => {
  const result = selectBestEmployee([], null);
  if (result !== null) throw new Error(`expected null, got ${JSON.stringify(result)}`);
});

Deno.test("selectBestEmployee: returns null when every candidate is inactive/error/offline", () => {
  const workforce = [
    employee({ id: "a", isActive: false }),
    employee({ id: "b", status: "error" }),
    employee({ id: "c", status: "offline" }),
  ];
  const result = selectBestEmployee(workforce, null);
  if (result !== null) throw new Error(`expected null, got ${JSON.stringify(result)}`);
});

Deno.test("selectBestEmployee: filters to the requested department when at least one match exists", () => {
  const workforce = [
    employee({ id: "sales-1", department: "SALES" }),
    employee({ id: "ops-1", department: "OPERATIONS" }),
  ];
  const result = selectBestEmployee(workforce, "OPERATIONS");
  if (result?.id !== "ops-1") throw new Error(`expected ops-1, got ${JSON.stringify(result)}`);
});

Deno.test("selectBestEmployee: department match is case-insensitive", () => {
  const workforce = [employee({ id: "ops-1", department: "operations" })];
  const result = selectBestEmployee(workforce, "OPERATIONS");
  if (result?.id !== "ops-1") throw new Error(`expected ops-1, got ${JSON.stringify(result)}`);
});

Deno.test("selectBestEmployee: falls back to the whole workforce when no one matches the department", () => {
  const workforce = [employee({ id: "sales-1", department: "SALES" })];
  const result = selectBestEmployee(workforce, "OPERATIONS");
  if (result?.id !== "sales-1") throw new Error(`expected fallback to sales-1, got ${JSON.stringify(result)}`);
});

Deno.test("selectBestEmployee: an employee with fewer active jobs wins over one with a higher success rate", () => {
  const workforce = [
    employee({ id: "busy-but-great", activeJobs: 5, successRate: 0.99 }),
    employee({ id: "free-and-ok", activeJobs: 0, successRate: 0.5 }),
  ];
  const result = selectBestEmployee(workforce, null);
  if (result?.id !== "free-and-ok") throw new Error(`expected free-and-ok (workload beats success rate), got ${JSON.stringify(result)}`);
});

Deno.test("selectBestEmployee: success rate is the tiebreaker when active-job counts are equal", () => {
  const workforce = [
    employee({ id: "low-rate", activeJobs: 2, successRate: 0.4 }),
    employee({ id: "high-rate", activeJobs: 2, successRate: 0.9 }),
  ];
  const result = selectBestEmployee(workforce, null);
  if (result?.id !== "high-rate") throw new Error(`expected high-rate, got ${JSON.stringify(result)}`);
});

Deno.test("selectBestEmployee: a null successRate is treated as 0, never as better than a scored competitor", () => {
  const workforce = [
    employee({ id: "unscored", activeJobs: 1, successRate: null }),
    employee({ id: "scored-low", activeJobs: 1, successRate: 0.1 }),
  ];
  const result = selectBestEmployee(workforce, null);
  if (result?.id !== "scored-low") throw new Error(`expected scored-low (any real score beats null), got ${JSON.stringify(result)}`);
});
