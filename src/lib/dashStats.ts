// The Dashboard's charts, computed from the task rows the page already loads (no extra queries).
import { periodBounds, type Period } from './dashPeriod';

export interface TRow { status: string; due_date: string | null; completed_at?: string | null; created_at: string }
const done = (r: TRow) => r.status === 'completed' || r.status === 'completed_cycle';
const ms = (s?: string | null) => (s ? Date.parse(s) : NaN);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface Bucket { start: number; end: number; label: string; title: string }
/** Week: a day each. Month: a week each. All time: a month each for the last 12 months. */
export function buckets(p: Period, now = new Date()): Bucket[] {
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const out: Bucket[] = [], b = periodBounds(p, now);
  if (p === 'week') for (let i = 0; i < 7; i++) {
    const d = new Date(b![0]); d.setDate(d.getDate() + i); const e = new Date(d); e.setDate(e.getDate() + 1);
    out.push({ start: d.getTime(), end: e.getTime(), label: DAYS[d.getDay()], title: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) });
  } else if (p === 'month') for (let d = new Date(b![0]); d.getTime() < b![1]; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
    const e = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime(), b![1]);
    out.push({ start: d.getTime(), end: e, label: md(d), title: `${md(d)} – ${md(new Date(e - 864e5))}` });
  } else for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1), e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({ start: d.getTime(), end: e.getTime(), label: d.toLocaleDateString('en-US', { month: 'short' }), title: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

const within = (t: number, b: { start: number; end: number }) => t >= b.start && t < b.end;

/** Per bucket: tasks created, tasks completed, and tasks that fell overdue (due in it, and finished late or not at all). */
export function throughput(rows: TRow[], p: Period, now = new Date()) {
  const t = now.getTime();
  return buckets(p, now).map((b) => ({
    ...b,
    future: b.start > t,
    created: rows.filter((r) => within(ms(r.created_at), b)).length,
    completed: rows.filter((r) => done(r) && within(ms(r.completed_at), b)).length,
    overdue: rows.filter((r) => { const due = ms(r.due_date); return within(due, b) && due < t && (!done(r) || ms(r.completed_at) > due); }).length,
  }));
}

/** The window the headline numbers cover, and the one just before it (for "vs last week"). All time compares the last 30 days. */
function windows(p: Period, now: Date): [[number, number], [number, number]] {
  const b = periodBounds(p, now);
  if (!b) { const t = now.getTime(); return [[t - 30 * 864e5, t], [t - 60 * 864e5, t - 30 * 864e5]]; }
  const prev = p === 'week' ? [b[0] - 7 * 864e5, b[0]] : [new Date(new Date(b[0]).getFullYear(), new Date(b[0]).getMonth() - 1, 1).getTime(), b[0]];
  return [b, prev as [number, number]];
}

/** Completion rate, share finished on time, average days from created to completed, and change in completions vs the previous period. */
export function headline(rows: TRow[], p: Period, now = new Date()) {
  const b = periodBounds(p, now);
  const inP = (s?: string | null) => !b || (!!s && ms(s) >= b[0] && ms(s) < b[1]);
  const finished = rows.filter((r) => done(r) && (!b || inP(r.completed_at)));
  const open = rows.filter((r) => !done(r) && inP(r.due_date));
  const dated = finished.filter((r) => r.due_date && r.completed_at);
  const spans = finished.filter((r) => r.completed_at).map((r) => (ms(r.completed_at) - ms(r.created_at)) / 864e5).filter((x) => x >= 0);
  const [cur, prev] = windows(p, now);
  const count = (w: [number, number]) => rows.filter((r) => done(r) && ms(r.completed_at) >= w[0] && ms(r.completed_at) < w[1]).length;
  const a = count(cur), z = count(prev);
  return {
    rate: finished.length + open.length ? Math.round((finished.length / (finished.length + open.length)) * 100) : null,
    onTime: dated.length ? Math.round((dated.filter((r) => ms(r.completed_at) <= ms(r.due_date)).length / dated.length) * 100) : null,
    avgDays: spans.length ? Math.round((spans.reduce((x, y) => x + y, 0) / spans.length) * 10) / 10 : null,
    change: z ? Math.round(((a - z) / z) * 100) : null,
    compare: p === 'week' ? 'vs last week' : p === 'month' ? 'vs last month' : 'last 30 days vs the 30 before',
  };
}

/** 12 points across the period (all time: the last 12 months) for the small trend lines on the number cards. */
export function sparks(rows: TRow[], p: Period, now = new Date()) {
  const b = periodBounds(p, now), t = now.getTime();
  const from = b ? b[0] : new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime(), to = Math.min(b ? b[1] : t, t);
  const pts = Array.from({ length: 12 }, (_, i) => from + ((to - from) * (i + 1)) / 12);
  const openAt = (x: number) => (r: TRow) => ms(r.created_at) <= x && !(done(r) && ms(r.completed_at) <= x);
  return {
    open: pts.map((x) => rows.filter(openAt(x)).length),
    overdue: pts.map((x) => rows.filter((r) => openAt(x)(r) && ms(r.due_date) < x).length),
    completed: pts.map((x) => rows.filter((r) => done(r) && ms(r.completed_at) >= from && ms(r.completed_at) <= x).length),
  };
}

/** Open tasks due on each day of this week (the bars on the Due today card), and how many fell overdue today. */
export function dueWeek(rows: TRow[], now = new Date()) {
  const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const days = Array.from({ length: 7 }, (_, i) => { const s = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i).getTime(); return { start: s, end: s + 864e5 }; });
  const today = days[now.getDay()], t = now.getTime();
  const openDue = rows.filter((r) => !done(r) && r.due_date);
  const leftToday = openDue.filter((r) => within(ms(r.due_date), today) && ms(r.due_date) >= t).map((r) => ms(r.due_date)).sort((x, y) => x - y);
  return {
    bars: days.map((d) => openDue.filter((r) => within(ms(r.due_date), d)).length),
    today: now.getDay(),
    lateToday: openDue.filter((r) => within(ms(r.due_date), today) && ms(r.due_date) < t).length,
    nextToday: leftToday[0] ?? null,
  };
}

/** Tasks completed in each of the last 12 months (the activity strip under the status mix). */
export function months12(rows: TRow[], now = new Date()) {
  return Array.from({ length: 12 }, (_, i) => {
    const s = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1), e = new Date(now.getFullYear(), now.getMonth() - 10 + i, 1);
    return { title: s.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), n: rows.filter((r) => done(r) && within(ms(r.completed_at), { start: s.getTime(), end: e.getTime() })).length };
  });
}

/** A smooth SVG path through points that never overshoots them (monotone cubic, Fritsch-Carlson), so a line never dips below zero. */
export function smooth(pts: [number, number][]) {
  const n = pts.length, f = (v: number) => v.toFixed(1);
  if (n < 2) return n ? `M${f(pts[0][0])} ${f(pts[0][1])}` : '';
  const m = pts.slice(0, -1).map((p, i) => (pts[i + 1][1] - p[1]) / (pts[i + 1][0] - p[0] || 1));
  const t = pts.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s2 = a * a + b * b;
    if (s2 > 9) { const k = 3 / Math.sqrt(s2); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = (x1 - x0) / 3;
    d += ` C${f(x0 + h)} ${f(y0 + t[i] * h)} ${f(x1 - h)} ${f(y1 - t[i + 1] * h)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}
