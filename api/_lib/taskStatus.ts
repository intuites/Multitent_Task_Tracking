export const TASK_STATUSES = [
  'not_yet_started', 'in_progress', 'in_review', 'blocked', 'escalation', 'completed', 'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const DEFAULT_TASK_STATUS: TaskStatus = 'not_yet_started';

const NEXT: Record<TaskStatus, TaskStatus[]> = {
  not_yet_started: ['in_progress', 'blocked', 'escalation', 'cancelled'],
  in_progress: ['in_review', 'blocked', 'escalation', 'completed', 'cancelled', 'not_yet_started'],
  in_review: ['in_progress', 'completed', 'blocked', 'escalation', 'cancelled'],
  blocked: ['in_progress', 'not_yet_started', 'escalation', 'cancelled'],
  // leaving escalation goes through resolveEscalation with an explicit target
  escalation: ['not_yet_started', 'in_progress', 'in_review', 'blocked', 'cancelled'],
  completed: ['in_progress'], // reopen
  cancelled: ['not_yet_started'],
};

export const canTransition = (from: TaskStatus, to: TaskStatus) => NEXT[from].includes(to);

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
