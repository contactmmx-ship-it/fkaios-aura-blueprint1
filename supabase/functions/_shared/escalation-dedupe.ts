export interface PendingEscalationRecord {
  action_type?: unknown;
  status?: unknown;
  payload?: unknown;
}

/** True only when a pending task/project escalation already exists for the same project. */
export function hasPendingEscalationForProject(
  rows: readonly PendingEscalationRecord[],
  projectId: string,
): boolean {
  return rows.some((row) => {
    if (row.status !== "pending") return false;
    if (row.action_type !== "escalation_blocked_task" && row.action_type !== "escalation_blocked_project") return false;
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) return false;
    return (row.payload as Record<string, unknown>).project_id === projectId;
  });
}
