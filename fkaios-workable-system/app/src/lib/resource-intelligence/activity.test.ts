import { describe, expect, it } from 'vitest';
import { createActivityTrail } from './activity';

describe('activity trail', () => {
  it('records ordered execution proceedings and streams new events', () => {
    const trail = createActivityTrail();
    const streamed: string[] = [];
    const unsubscribe = trail.subscribe((event) => streamed.push(`${event.phase}:${event.status}`));

    trail.append({ taskId: 'task-1', phase: 'decision', status: 'completed', title: 'Resource selected' });
    trail.append({ taskId: 'task-1', phase: 'execution', status: 'running', title: 'Worker executing' });
    trail.append({ taskId: 'task-1', phase: 'verification', status: 'completed', title: 'Outcome verified' });

    expect(trail.list('task-1')).toHaveLength(3);
    expect(streamed).toEqual([
      'decision:completed',
      'execution:running',
      'verification:completed',
    ]);
    unsubscribe();
    trail.append({ taskId: 'task-1', phase: 'recovery', status: 'waiting', title: 'Awaiting handoff' });
    expect(streamed).toHaveLength(3);
  });
});
