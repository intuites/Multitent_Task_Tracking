export type ProgressMode = 'manual' | 'milestones' | 'tasks';

const pct = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 100));

/** Cancelled tasks are excluded from the denominator so they never count as completed. */
export function projectProgress(
  mode: ProgressMode,
  manual: number,
  milestones: { completed_at: string | null }[],
  tasks: { status: string }[],
): number {
  if (mode === 'manual') return manual;
  if (mode === 'milestones') return pct(milestones.filter((m) => m.completed_at).length, milestones.length);
  const live = tasks.filter((t) => t.status !== 'cancelled');
  return pct(live.filter((t) => t.status === 'completed' || t.status === 'completed_cycle').length, live.length);
}
