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
