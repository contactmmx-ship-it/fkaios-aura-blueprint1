export type ActivityPhase =
  | 'objective'
  | 'decision'
  | 'task'
  | 'worker'
  | 'resource'
  | 'execution'
  | 'verification'
  | 'recovery'
  | 'human_gate';

export type ActivityStatus = 'running' | 'completed' | 'waiting' | 'blocked' | 'unknown' | 'failed';

export interface ActivityEvent {
  id: string;
  taskId?: string;
  phase: ActivityPhase;
  status: ActivityStatus;
  title: string;
  detail?: string;
  evidence?: string[];
  providerId?: string;
  attempt?: number;
  createdAt: string;
}

export interface ActivityTrail {
  append(event: Omit<ActivityEvent, 'id' | 'createdAt'>): ActivityEvent;
  list(taskId?: string): ActivityEvent[];
  subscribe(listener: (event: ActivityEvent) => void): () => void;
}

function makeId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createActivityTrail(initial: ActivityEvent[] = []): ActivityTrail {
  const events = [...initial];
  const listeners = new Set<(event: ActivityEvent) => void>();

  return {
    append(input) {
      const event: ActivityEvent = { ...input, id: makeId(), createdAt: new Date().toISOString() };
      events.push(event);
      for (const listener of listeners) listener(event);
      return event;
    },
    list(taskId) {
      return taskId ? events.filter((event) => event.taskId === taskId) : [...events];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
