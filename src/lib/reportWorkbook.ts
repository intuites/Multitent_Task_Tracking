import { buildXlsx, COLORS, colName, type Cell, type Chart, type Sheet, type Style } from './xlsx';

export interface Task { id: string; org_id?: string; title: string; status: string; priority: string; department_id: string | null; due_date: string | null; start_date?: string | null;
  created_at: string; completed_at: string | null; tt_task_assignees: { user_id: string }[] }
export interface Person { id: string; name: string; email: string; role: string }
export interface Dept { id: string; name: string }
type Label = (s: string) => string;
interface Input { org: string; filters: string; tasks: Task[]; depts: Dept[]; people: Person[]; label: Label }

const DONE = ['completed', 'completed_cycle'];
const STATUSES = ['not_yet_started', 'started', 'pending', 'completed_cycle', 'completed'];
const STATUS_STYLE: Record<string, Style> = { completed: 'done', completed_cycle: 'done', started: 'started', pending: 'pending', not_yet_started: 'idle', escalation: 'bad' };
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
// chart colours that match each status's meaning
const STATUS_COLOR: Record<string, string> = { not_yet_started: '9AA5A0', started: '4A90D9', pending: 'F2B134', completed_cycle: '7CC49C', completed: '1B5E3B' };
const SERIES = ['1B5E3B', '4A90D9', 'F2B134', 'E06C5A', '8E7CC3', '3F9D6B', 'D9822B', '2BB3B1'];
const d = (s?: string | null) => (s ? new Date(s) : null);

// ---------- shared measures and cell helpers ----------
const isDone = (t: Task) => DONE.includes(t.status);
const overdue = (t: Task) => !isDone(t) && !!t.due_date && Date.parse(t.due_date) < Date.now();
const late = (t: Task) => isDone(t) && !!t.due_date && !!t.completed_at && Date.parse(t.completed_at) > Date.parse(t.due_date);
export const stats = (list: Task[]) => {
  const done = list.filter(isDone).length, since = Date.now() - 30 * 864e5;
  return { total: list.length, open: list.length - done, done, overdue: list.filter(overdue).length,
    rate: list.length ? done / list.length : 0, onTime: done ? (done - list.filter(late).length) / done : 0,
    done30: list.filter((t) => t.completed_at && Date.parse(t.completed_at) >= since).length,
    new30: list.filter((t) => Date.parse(t.created_at) >= since).length };
};
const head = (cols: string[]): Cell[] => cols.map((c) => ({ v: c, s: 'head' as Style }));
const pct = (v: number): Cell => ({ v, s: 'pct' });
const zebra = (i: number) => ({ tx: (i % 2 ? 'zText' : 'text') as Style, nm: (i % 2 ? 'zNum' : 'num') as Style, dt: (i % 2 ? 'zDate' : 'date') as Style });
const banner = (title: string, who: string, filters: string, cols: number): { rows: Cell[][]; merges: string[] } => ({
  rows: [[{ v: title, s: 'title' }], [{ v: `${who} · generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · ${filters}`, s: 'sub' }], []],
  merges: [`A1:${colName(cols - 1)}1`, `A2:${colName(cols - 1)}2`],
});
const months = () => Array.from({ length: 12 }, (_, i) => { const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); m.setMonth(m.getMonth() - 11 + i); return m; });
const inMonth = (s: string | null, m: Date) => { if (!s) return false; const x = new Date(s); return x.getFullYear() === m.getFullYear() && x.getMonth() === m.getMonth(); };
const monthName = (m: Date) => m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

/** A dashboard-like sheet: tables stacked down the left, a chart beside each one. */
function stack(rows: Cell[][]) {
  const charts: Chart[] = [];
  const block = (title: string, cols: string[], body: Cell[][], chart?: (first: number, last: number) => Chart) => {
    const top = rows.length;
    rows.push([{ v: title, s: 'section' }], head(cols), ...body);
    if (chart && body.length) charts.push(chart(top + 2, top + 1 + body.length));
    // leave room for the chart (16 rows) before the next block
    while (rows.length < top + Math.max(body.length + 3, 18)) rows.push([]);
  };
  return { charts, block };
}

/** One organization at a glance: key numbers, status, departments, priority and a 12-month trend, each with a chart. */
function summarySheet({ org, filters, tasks, depts, label }: Input, sheetName: string): Sheet {
  const all = stats(tasks);
  const ban = banner(`Task report — ${org}`, org, filters, 12);
  const { charts, block } = stack(ban.rows);
  block('Key numbers', ['Measure', 'Value'], [
    [{ v: 'Tasks in scope', s: 'kpiLabel' }, { v: all.total, s: 'kpiNum' }],
    [{ v: 'Completed', s: 'kpiLabel' }, { v: all.done, s: 'kpiNum' }],
    [{ v: 'Open', s: 'kpiLabel' }, { v: all.open, s: 'kpiNum' }],
    [{ v: 'Overdue', s: 'kpiLabel' }, { v: all.overdue, s: 'kpiNum' }],
    [{ v: 'Completion rate', s: 'kpiLabel' }, { v: all.rate, s: 'kpiPct' }],
    [{ v: 'Completed on time', s: 'kpiLabel' }, { v: all.onTime, s: 'kpiPct' }],
    [{ v: 'Completed in last 30 days', s: 'kpiLabel' }, { v: all.done30, s: 'kpiNum' }],
    [{ v: 'People with tasks', s: 'kpiLabel' }, { v: new Set(tasks.flatMap((t) => t.tt_task_assignees.map((a) => a.user_id))).size, s: 'kpiNum' }],
  // rows a+1 / a+2 are Completed / Open
  ], (a) => ({ type: 'doughnut', title: 'Completed vs open', colors: [COLORS.brand, COLORS.amber], cats: { col: 0, from: a + 1, to: a + 2 }, at: { col: 3, row: a - 2, w: 8, h: 16 },
    series: [{ name: 'Tasks', vals: { col: 1, from: a + 1, to: a + 2 }, color: COLORS.green }] }));
  block('Tasks by status', ['Status', 'Tasks', 'Share'], STATUSES.map((s) => {
    const n = tasks.filter((t) => t.status === s).length;
    return [{ v: label(s), s: STATUS_STYLE[s] }, n, pct(all.total ? n / all.total : 0)];
  }), (a, b) => ({ type: 'pie', title: 'Tasks by status', colors: STATUSES.map((s) => STATUS_COLOR[s]), cats: { col: 0, from: a, to: b }, series: [{ name: 'Tasks', vals: { col: 1, from: a, to: b }, color: COLORS.green }], at: { col: 4, row: a - 2, w: 8, h: 16 } }));
  const byDept = deptStats(tasks, depts);
  block('Tasks by department', ['Department', 'Open', 'Completed', 'Overdue'], byDept.map((x) => [x.name, x.s.open, x.s.done, x.s.overdue]),
    (a, b) => ({ type: 'col', title: 'Work by department', cats: { col: 0, from: a, to: b }, at: { col: 5, row: a - 2, w: 8, h: 16 },
      series: [{ name: 'Open', vals: { col: 1, from: a, to: b }, color: COLORS.amber }, { name: 'Completed', vals: { col: 2, from: a, to: b }, color: COLORS.green }, { name: 'Overdue', vals: { col: 3, from: a, to: b }, color: COLORS.red }] }));
  block('Tasks by priority', ['Priority', 'Open', 'Completed'], PRIORITIES.map((p) => { const s = stats(tasks.filter((t) => t.priority === p)); return [label(p), s.open, s.done]; }),
    (a, b) => ({ type: 'bar', title: 'Priority mix', cats: { col: 0, from: a, to: b }, at: { col: 4, row: a - 2, w: 8, h: 16 },
      series: [{ name: 'Open', vals: { col: 1, from: a, to: b }, color: COLORS.amber }, { name: 'Completed', vals: { col: 2, from: a, to: b }, color: COLORS.green }] }));
  block('Last 12 months', ['Month', 'Created', 'Completed'], months().map((m) => [monthName(m),
    tasks.filter((t) => inMonth(t.created_at, m)).length, tasks.filter((t) => inMonth(t.completed_at, m)).length]),
    (a, b) => ({ type: 'line', title: 'Created vs completed per month', cats: { col: 0, from: a, to: b }, at: { col: 4, row: a - 2, w: 9, h: 16 },
      series: [{ name: 'Created', vals: { col: 1, from: a, to: b }, color: COLORS.blue }, { name: 'Completed', vals: { col: 2, from: a, to: b }, color: COLORS.green }] }));
  return { name: sheetName, rows: ban.rows, charts, merges: ban.merges, tall: [0], widths: [28, 12, 12, 12, 4, 12, 12, 12, 12, 12, 12, 12, 12] };
}

const deptStats = (tasks: Task[], depts: Dept[]) => [...depts.map((x) => x.id), null]
  .map((id) => ({ name: depts.find((x) => x.id === id)?.name ?? 'No department', s: stats(tasks.filter((t) => (t.department_id ?? null) === id)) })).filter((x) => x.s.total);

/** People table (optionally with their organization) and a bar chart of the top performers. */
function peopleSheet(rowsIn: { p: Person; org?: string; s: ReturnType<typeof stats> }[], who: string, filters: string, label: Label, title = 'Performance by person', sheetName = 'People'): Sheet {
  const withOrg = rowsIn.some((r) => r.org !== undefined);
  const cols = ['Person', ...(withOrg ? ['Organization'] : []), 'Email', 'Role', 'Assigned', 'Open', 'Completed', 'Overdue', 'Completion', 'On time', 'Done (30 days)'];
  const ban = banner(title, who, filters, cols.length);
  const list = rowsIn.filter((x) => x.s.total).sort((a, b) => b.s.done - a.s.done || b.s.rate - a.s.rate);
  const top = ban.rows.length + 1, o = withOrg ? 1 : 0;
  ban.rows.push(head(cols), ...list.map(({ p, org, s }, i): Cell[] => {
    const z = zebra(i);
    return [{ v: p.name, s: z.tx }, ...(withOrg ? [{ v: org ?? '', s: z.tx }] : []), { v: p.email, s: z.tx }, { v: label(p.role), s: z.tx },
      { v: s.total, s: z.nm }, { v: s.open, s: z.nm }, { v: s.done, s: z.nm }, { v: s.overdue, s: s.overdue ? 'badText' : z.nm }, pct(s.rate), pct(s.onTime), { v: s.done30, s: z.nm }];
  }));
  // chart the top 25 so it stays readable
  const last = top + Math.min(list.length, 25) - 1;
  return { name: sheetName, rows: ban.rows, merges: ban.merges, tall: [0], freeze: top,
    widths: [24, ...(withOrg ? [22] : []), 28, 12, 11, 10, 12, 10, 12, 10, 13],
    filter: list.length ? { row: top - 1, cols: cols.length, last: top + list.length - 1 } : undefined,
    charts: list.length ? [{ type: 'bar', title: list.length > 25 ? 'Top 25 people: completed, open, overdue' : 'Completed, open and overdue by person', cats: { col: 0, from: top, to: last },
      at: { col: cols.length + 1, row: 2, w: 9, h: Math.max(16, (last - top + 1) * 2 + 4) },
      series: [{ name: 'Completed', vals: { col: 5 + o, from: top, to: last }, color: COLORS.green }, { name: 'Open', vals: { col: 4 + o, from: top, to: last }, color: COLORS.amber },
        { name: 'Overdue', vals: { col: 6 + o, from: top, to: last }, color: COLORS.red }] }] : [] };
}

function deptSheet({ org, filters, tasks, depts }: Input): Sheet {
  const byDept = deptStats(tasks, depts);
  const ban = banner('Performance by department', org, filters, 7);
  const top = ban.rows.length + 1;
  ban.rows.push(head(['Department', 'Tasks', 'Open', 'Completed', 'Overdue', 'Completion', 'On time']),
    ...byDept.map((x, i): Cell[] => { const z = zebra(i); return [{ v: x.name, s: z.tx }, { v: x.s.total, s: z.nm }, { v: x.s.open, s: z.nm },
      { v: x.s.done, s: z.nm }, { v: x.s.overdue, s: x.s.overdue ? 'badText' : z.nm }, pct(x.s.rate), pct(x.s.onTime)]; }));
  const last = top + byDept.length - 1;
  return { name: 'Departments', rows: ban.rows, merges: ban.merges, tall: [0], freeze: top, widths: [26, 10, 10, 12, 10, 12, 10],
    charts: byDept.length ? [
      { type: 'col', title: 'Tasks by department', cats: { col: 0, from: top, to: last }, at: { col: 8, row: 2, w: 9, h: 16 },
        series: [{ name: 'Completed', vals: { col: 3, from: top, to: last }, color: COLORS.green }, { name: 'Open', vals: { col: 2, from: top, to: last }, color: COLORS.amber },
          { name: 'Overdue', vals: { col: 4, from: top, to: last }, color: COLORS.red }] },
      { type: 'doughnut', title: 'Share of all tasks', cats: { col: 0, from: top, to: last }, at: { col: 8, row: 19, w: 9, h: 16 },
        series: [{ name: 'Tasks', vals: { col: 1, from: top, to: last }, color: COLORS.green }] }] : [] };
}

/** Every task, newest first, colour-coded, with filters. orgOf adds an Organization column. */
function taskSheet(tasks: Task[], who: string, filters: string, label: Label, deptName: (t: Task) => string, personName: (id: string) => string, orgOf?: (t: Task) => string): Sheet {
  const cols = [...(orgOf ? ['Organization'] : []), 'Task', 'Status', 'Priority', 'Department', 'Assigned to', 'Created', 'Starts', 'Due', 'Completed', 'Overdue'];
  const ban = banner('All tasks', who, filters, cols.length);
  const top = ban.rows.length;
  ban.rows.push(head(cols), ...[...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((t, i): Cell[] => {
    const z = zebra(i), od = overdue(t);
    return [...(orgOf ? [{ v: orgOf(t), s: z.tx }] : []), { v: t.title, s: z.tx }, { v: label(t.status), s: STATUS_STYLE[t.status] ?? z.tx },
      { v: label(t.priority), s: t.priority === 'urgent' ? 'badText' : z.tx }, { v: deptName(t), s: z.tx },
      { v: t.tt_task_assignees.map((a) => personName(a.user_id)).join(', ') || 'Unassigned', s: z.tx },
      { v: d(t.created_at), s: z.dt }, { v: d(t.start_date), s: z.dt }, { v: d(t.due_date), s: z.dt }, { v: d(t.completed_at), s: z.dt }, { v: od ? 'Yes' : 'No', s: od ? 'bad' : z.nm }];
  }));
  return { name: 'All tasks', rows: ban.rows, merges: ban.merges, tall: [0], freeze: top + 1, widths: [...(orgOf ? [22] : []), 44, 20, 13, 20, 30, 14, 14, 14, 15, 12],
    filter: { row: top, cols: cols.length, last: top + tasks.length } };
}

/** Organization report as a styled, multi-sheet Excel workbook with charts. */
export function reportWorkbook(input: Input): Blob {
  const { org, filters, tasks, depts, people, label } = input;
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'Former member';
  return buildXlsx([
    summarySheet(input, 'Summary'),
    peopleSheet(people.map((p) => ({ p, s: stats(tasks.filter((t) => t.tt_task_assignees.some((a) => a.user_id === p.id))) })), org, filters, label),
    deptSheet(input),
    taskSheet(tasks, org, filters, label, (t) => depts.find((x) => x.id === t.department_id)?.name ?? 'No department', name),
  ]);
}

// ======================= platform: every organization side by side =======================
export interface PlatformInput {
  orgs: { id: string; name: string; created_at: string }[];
  members: { org_id: string; user_id: string; role: string; active: boolean }[];
  profiles: { user_id: string; full_name: string | null; email: string | null }[];
  depts: (Dept & { org_id: string })[];
  tasks: (Task & { org_id: string })[];
  label: Label;
}

// Excel sheet names: max 31 chars, no []:*?/\ and unique
function sheetNamer(taken: string[]) {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  return (raw: string) => {
    const base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 28) || 'Organization';
    let name = base, n = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} (${n++})`;
    used.add(name.toLowerCase());
    return name;
  };
}

/** Whole platform: organizations compared side by side, monthly trend per organization, a people leaderboard,
 *  one dashboard sheet per organization, and every task. */
export function platformWorkbook({ orgs, members, profiles, depts, tasks, label }: PlatformInput): Blob {
  const who = 'All organizations', filters = `${orgs.length} organizations`;
  const prof = new Map(profiles.map((p) => [p.user_id, p]));
  const personName = (id: string) => prof.get(id)?.full_name || prof.get(id)?.email || 'Former member';
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const tasksOf = (id: string) => tasks.filter((t) => t.org_id === id);
  const peopleOf = (id: string): Person[] => members.filter((m) => m.org_id === id && m.active)
    .map((m) => ({ id: m.user_id, name: personName(m.user_id), email: prof.get(m.user_id)?.email ?? '', role: m.role }));
  const per = orgs.map((o) => ({ o, s: stats(tasksOf(o.id)), members: peopleOf(o.id).length, depts: depts.filter((x) => x.org_id === o.id).length }))
    .sort((a, b) => b.s.rate - a.s.rate || b.s.done - a.s.done);
  const all = stats(tasks);

  // ---------- Overview: platform numbers, then organizations ranked, with charts ----------
  const ban = banner('Platform report — every organization', who, filters, 14);
  const rows = ban.rows, charts: Chart[] = [];
  rows.push([{ v: 'Platform at a glance', s: 'section' }]);
  const kpis: [string, number, boolean?][] = [['Organizations', orgs.length], ['Active members', new Set(members.filter((m) => m.active).map((m) => m.user_id)).size],
    ['Departments', depts.length], ['Tasks', all.total], ['Completed', all.done], ['Open', all.open], ['Overdue', all.overdue],
    ['Completion rate', all.rate, true], ['Completed on time', all.onTime, true], ['Completed in last 30 days', all.done30], ['Created in last 30 days', all.new30]];
  rows.push(head(['Measure', 'Value']), ...kpis.map(([k, v, p]): Cell[] => [{ v: k, s: 'kpiLabel' }, { v, s: p ? 'kpiPct' : 'kpiNum' }]), []);
  const tTop = rows.length + 1;
  rows.push([{ v: 'Organizations ranked by completion rate', s: 'section' }]);
  const cols = ['Rank', 'Organization', 'Members', 'Departments', 'Tasks', 'Open', 'Completed', 'Overdue', 'Completion %', 'On time', 'Done (30 days)', 'New (30 days)', 'Created on'];
  rows.push(head(cols), ...per.map(({ o, s, members: m, depts: dc }, i): Cell[] => {
    const z = zebra(i);
    return [{ v: i + 1, s: i < 3 ? 'kpiNum' : z.nm }, { v: o.name, s: i < 3 ? 'kpiLabel' : z.tx }, { v: m, s: z.nm }, { v: dc, s: z.nm }, { v: s.total, s: z.nm }, { v: s.open, s: z.nm },
      { v: s.done, s: z.nm }, { v: s.overdue, s: s.overdue ? 'badText' : z.nm }, { v: Math.round(s.rate * 100), s: z.nm }, pct(s.onTime), { v: s.done30, s: z.nm }, { v: s.new30, s: z.nm }, { v: d(o.created_at), s: z.dt }];
  }));
  const first = tTop + 1, last = tTop + per.length;
  if (per.length) {
    const below = last + 3, wide = Math.max(10, Math.min(per.length * 2, 20));
    charts.push(
      { type: 'doughnut', title: 'Share of all tasks by organization', cats: { col: 1, from: first, to: last }, at: { col: 3, row: 3, w: 7, h: 13 },
        series: [{ name: 'Tasks', vals: { col: 4, from: first, to: last }, color: COLORS.green }] },
      { type: 'col', title: 'Open, completed and overdue by organization', cats: { col: 1, from: first, to: last }, at: { col: 0, row: below, w: wide, h: 18 },
        series: [{ name: 'Completed', vals: { col: 6, from: first, to: last }, color: COLORS.green }, { name: 'Open', vals: { col: 5, from: first, to: last }, color: COLORS.amber },
          { name: 'Overdue', vals: { col: 7, from: first, to: last }, color: COLORS.red }] },
      { type: 'bar', title: 'Completion rate (%) by organization', cats: { col: 1, from: first, to: last }, at: { col: 0, row: below + 19, w: wide, h: Math.max(14, per.length * 2 + 4) },
        series: [{ name: 'Completion %', vals: { col: 8, from: first, to: last }, color: COLORS.brand }] },
      { type: 'col', title: 'Last 30 days: created vs completed', cats: { col: 1, from: first, to: last }, at: { col: 0, row: below + 20 + Math.max(14, per.length * 2 + 4), w: wide, h: 16 },
        series: [{ name: 'Created', vals: { col: 11, from: first, to: last }, color: COLORS.blue }, { name: 'Completed', vals: { col: 10, from: first, to: last }, color: COLORS.green }] },
    );
  }
  // column A holds both the key-number labels and the rank, so it is sized for the labels
  const overview: Sheet = { name: 'Overview', rows, charts, merges: ban.merges, tall: [0], widths: [26, 28, 12, 15, 10, 10, 13, 12, 14, 11, 15, 14, 15],
    filter: per.length ? { row: tTop, cols: cols.length, last } : undefined };

  // ---------- Monthly trend: completed per organization per month ----------
  const mb = banner('Monthly trend by organization', who, filters, Math.max(4, orgs.length + 3));
  const ms = months(), mTop = mb.rows.length + 1;
  const ranked = [...per].sort((a, b) => b.s.total - a.s.total);
  mb.rows.push([{ v: 'Tasks completed each month', s: 'section' }]);
  mb.rows.push(head(['Month', 'All created', 'All completed', ...ranked.map((x) => x.o.name)]),
    ...ms.map((m, i): Cell[] => {
      const z = zebra(i);
      return [{ v: monthName(m), s: z.tx }, { v: tasks.filter((t) => inMonth(t.created_at, m)).length, s: z.nm }, { v: tasks.filter((t) => inMonth(t.completed_at, m)).length, s: z.nm },
        ...ranked.map((x) => ({ v: tasksOf(x.o.id).filter((t) => inMonth(t.completed_at, m)).length, s: z.nm }))];
    }));
  const mFirst = mTop + 1, mLast = mTop + ms.length, chartAt = mLast + 3;
  const trend: Sheet = { name: 'Monthly trend', rows: mb.rows, merges: mb.merges, tall: [0], widths: [12, 12, 13, ...ranked.map(() => 16)],
    charts: [
      { type: 'line', title: 'Platform: created vs completed per month', cats: { col: 0, from: mFirst, to: mLast }, at: { col: 0, row: chartAt, w: 9, h: 17 },
        series: [{ name: 'Created', vals: { col: 1, from: mFirst, to: mLast }, color: COLORS.blue }, { name: 'Completed', vals: { col: 2, from: mFirst, to: mLast }, color: COLORS.green }] },
      ...(ranked.length ? [{ type: 'line' as const, title: ranked.length > 8 ? 'Completed per month: 8 busiest organizations' : 'Completed per month by organization',
        cats: { col: 0, from: mFirst, to: mLast }, at: { col: 10, row: chartAt, w: 10, h: 17 },
        series: ranked.slice(0, 8).map((x, i) => ({ name: x.o.name, vals: { col: 3 + i, from: mFirst, to: mLast }, color: SERIES[i] })) }] : []),
    ] };

  // ---------- People leaderboard across organizations ----------
  const leaderboard = peopleSheet(orgs.flatMap((o) => peopleOf(o.id).map((p) => ({ p, org: o.name, s: stats(tasksOf(o.id).filter((t) => t.tt_task_assignees.some((a) => a.user_id === p.id))) }))),
    who, filters, label, 'People leaderboard — all organizations', 'People leaderboard');

  // ---------- one dashboard sheet per organization ----------
  const nameSheet = sheetNamer(['Overview', 'Monthly trend', 'People leaderboard', 'All tasks']);
  const orgSheets = per.map(({ o }) => summarySheet({ org: o.name, filters: 'All tasks', tasks: tasksOf(o.id), depts: depts.filter((x) => x.org_id === o.id), people: peopleOf(o.id), label }, nameSheet(o.name)));

  // ---------- every task ----------
  const deptName = new Map(depts.map((x) => [x.id, x.name]));
  const taskList = taskSheet(tasks, who, filters, label, (t) => (t.department_id && deptName.get(t.department_id)) || 'No department', personName, (t) => orgName.get(t.org_id!) ?? '');

  return buildXlsx([overview, trend, leaderboard, ...orgSheets, taskList]);
}
