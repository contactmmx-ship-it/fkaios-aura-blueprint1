// Compact task envelopes before persistence without truncating JSON.
// Research responses carry a large raw capability_result that is already
// represented by compactDispatchForStorage(companyOsDispatch). Keeping both
// copies can exceed the old 20k limit; slicing JSON at that limit made it
// invalid and erased the capability evidence the objective verifier needs.
export function prepareTaskOutputForStorage(finalOutput: unknown): unknown {
  if (!finalOutput || typeof finalOutput !== "object" || Array.isArray(finalOutput)) return finalOutput;
  const envelope = finalOutput as Record<string, unknown>;
  const dispatch = envelope.companyOsDispatch;
  const llmResult = envelope.llmResult;
  if (!dispatch || typeof dispatch !== "object" || !llmResult || typeof llmResult !== "object" || Array.isArray(llmResult)) {
    return finalOutput;
  }
  const dispatchObj = dispatch as Record<string, unknown>;
  const resultObj = llmResult as Record<string, unknown>;
  if (dispatchObj.capability !== "research.run" || resultObj.capability !== "research.run" || !("capability_result" in resultObj)) {
    return finalOutput;
  }
  const compactResult = { ...resultObj };
  delete compactResult.capability_result;
  return { ...envelope, llmResult: compactResult };
}

export function serializeTaskOutput(finalOutput: unknown): string {
  const serialized = JSON.stringify(prepareTaskOutputForStorage(finalOutput));
  if (typeof serialized !== "string") throw new Error("Task output is not JSON-serializable");
  return serialized;
}


// Empty model envelopes are not task evidence. Ordinary text, populated arrays,
// and substantive object fields pass; empty objects/arrays and metadata-only
// envelopes do not.
export function hasSubstantiveTaskOutput(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.some((item) => hasSubstantiveTaskOutput(item, depth + 1));
  if (typeof value !== "object") return false;
  const ignoredKeys = new Set([
    "status", "success", "ok", "id", "task_id", "job_id", "provider", "model",
    "usage", "created_at", "updated_at", "duration_ms", "metadata", "attempts",
  ]);
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !ignoredKeys.has(key))
    .some(([, item]) => hasSubstantiveTaskOutput(item, depth + 1));
}
