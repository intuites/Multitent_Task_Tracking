export const TASK_STATUSES = [
  'not_yet_started', 'started', 'pending', 'escalation', 'completed_cycle', 'completed',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const DEFAULT_TASK_STATUS: TaskStatus = 'not_yet_started';
/** Finished for good, or finished until the task's next cycle (its reminder frequency). */
export const DONE_STATUSES: readonly string[] = ['completed', 'completed_cycle'];

// any status to any other; escalation is entered and left only through the escalation workflow (mirrors tt_transition_ok)
const WORK: readonly string[] = ['not_yet_started', 'started', 'pending', 'completed_cycle', 'completed'];
export const canTransition = (from: TaskStatus, to: TaskStatus) => from !== to && WORK.includes(from) && WORK.includes(to);

/** True if adding blocker -> task would create a cycle. edges: taskId -> ids it is blocked by. */
export function createsCycle(edges: Map<string, string[]>, task: string, blockedBy: string): boolean {
  if (task === blockedBy) return true;
  const seen = new Set<string>();
  const stack = [blockedBy];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === task) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(edges.get(cur) ?? []));
  }
  return false;
}
