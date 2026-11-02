import { buildXlsx, COLORS, colName, type Cell, type Chart, type Sheet, type Style } from './xlsx';

interface Task { id: string; title: string; status: string; priority: string; department_id: string | null; due_date: string | null; start_date?: string | null;
  created_at: string; completed_at: string | null; tt_task_assignees: { user_id: string }[] }
interface Input { org: string; filters: string; tasks: Task[]; depts: { id: string; name: string }[]; people: { id: string; name: string; email: string; role: string }[];
  label: (s: string) => string }

const DONE = ['completed', 'completed_cycle'];
const STATUSES = ['not_yet_started', 'started', 'pending', 'completed_cycle', 'completed'];
const STATUS_STYLE: Record<string, Style> = { completed: 'done', completed_cycle: 'done', started: 'started', pending: 'pending', not_yet_started: 'idle', escalation: 'bad' };
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
// chart colours that match each status's meaning
const STATUS_COLOR: Record<string, string> = { not_yet_started: '9AA5A0', started: '4A90D9', pending: 'F2B134', completed_cycle: '7CC49C', completed: '1B5E3B' };
const d = (s?: string | null) => (s ? new Date(s) : null);

/** Organization report as a styled, multi-sheet Excel workbook with charts. */
export function reportWorkbook({ org, filters, tasks, depts, people, label }: Input): Blob {
  const now = Date.now();
  const isDone = (t: Task) => DONE.includes(t.status);
  const overdue = (t: Task) => !isDone(t) && !!t.due_date && Date.parse(t.due_date) < now;
  const late = (t: Task) => isDone(t) && !!t.due_date && !!t.completed_at && Date.parse(t.completed_at) > Date.parse(t.due_date);
  const stats = (list: Task[]) => {
    const done = list.filter(isDone).length;
    return { total: list.length, open: list.length - done, done, overdue: list.filter(overdue).length,
      rate: list.length ? done / list.length : 0, onTime: done ? (done - list.filter(late).length) / done : 0 };
  };
  const all = stats(tasks);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'Former member';
  const deptName = (id: string | null) => depts.find((x) => x.id === id)?.name ?? 'No department';
  const head = (cols: string[]): Cell[] => cols.map((c) => ({ v: c, s: 'head' as Style }));
  const pct = (v: number): Cell => ({ v, s: 'pct' });
  const banner = (title: string, cols: number): { rows: Cell[][]; merges: string[] } => ({
    rows: [[{ v: title, s: 'title' }], [{ v: `${org} · generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · ${filters}`, s: 'sub' }], []],
    merges: [`A1:${colName(cols - 1)}1`, `A2:${colName(cols - 1)}2`],
  });

  // ---------- Summary: key numbers + four tables, each with a chart beside it ----------
  const sum = banner(`Task report — ${org}`, 12);
  const rows = sum.rows, charts: Chart[] = [];
  const block = (title: string, cols: string[], body: Cell[][], chart?: (first: number, last: number) => Chart) => {
    const top = rows.length;
    rows.push([{ v: title, s: 'section' }], head(cols), ...body);
    if (chart && body.length) charts.push(chart(top + 2, top + 1 + body.length));
    // leave room for the chart (16 rows) before the next block
    while (rows.length < top + Math.max(body.length + 3, 18)) rows.push([]);
  };
  block('Key numbers', ['Measure', 'Value'], [
    [{ v: 'Tasks in scope', s: 'kpiLabel' }, { v: all.total, s: 'kpiNum' }],
    [{ v: 'Completed', s: 'kpiLabel' }, { v: all.done, s: 'kpiNum' }],
    [{ v: 'Open', s: 'kpiLabel' }, { v: all.open, s: 'kpiNum' }],
    [{ v: 'Overdue', s: 'kpiLabel' }, { v: all.overdue, s: 'kpiNum' }],
    [{ v: 'Completion rate', s: 'kpiLabel' }, { v: all.rate, s: 'kpiPct' }],
    [{ v: 'Completed on time', s: 'kpiLabel' }, { v: all.onTime, s: 'kpiPct' }],
    [{ v: 'People with tasks', s: 'kpiLabel' }, { v: new Set(tasks.flatMap((t) => t.tt_task_assignees.map((a) => a.user_id))).size, s: 'kpiNum' }],
  // rows a+1 / a+2 are Completed / Open
  ], (a) => ({ type: 'doughnut', title: 'Completed vs open', colors: [COLORS.brand, COLORS.amber], cats: { col: 0, from: a + 1, to: a + 2 }, at: { col: 3, row: a - 2, w: 8, h: 16 },
    series: [{ name: 'Tasks', vals: { col: 1, from: a + 1, to: a + 2 }, color: COLORS.green }] }));
  block('Tasks by status', ['Status', 'Tasks', 'Share'], STATUSES.map((s) => {
    const n = tasks.filter((t) => t.status === s).length;
    return [{ v: label(s), s: STATUS_STYLE[s] }, n, pct(all.total ? n / all.total : 0)];
  }), (a, b) => ({ type: 'pie', title: 'Tasks by status', colors: STATUSES.map((s) => STATUS_COLOR[s]), cats: { col: 0, from: a, to: b }, series: [{ name: 'Tasks', vals: { col: 1, from: a, to: b }, color: COLORS.green }], at: { col: 4, row: a - 2, w: 8, h: 16 } }));
  const byDept = [...depts.map((x) => x.id), null].map((id) => ({ name: deptName(id), s: stats(tasks.filter((t) => (t.department_id ?? null) === id)) })).filter((x) => x.s.total);
  block('Tasks by department', ['Department', 'Open', 'Completed', 'Overdue'], byDept.map((x) => [x.name, x.s.open, x.s.done, x.s.overdue]),
    (a, b) => ({ type: 'col', title: 'Work by department', cats: { col: 0, from: a, to: b }, at: { col: 5, row: a - 2, w: 8, h: 16 },
      series: [{ name: 'Open', vals: { col: 1, from: a, to: b }, color: COLORS.amber }, { name: 'Completed', vals: { col: 2, from: a, to: b }, color: COLORS.green }, { name: 'Overdue', vals: { col: 3, from: a, to: b }, color: COLORS.red }] }));
  block('Tasks by priority', ['Priority', 'Open', 'Completed'], PRIORITIES.map((p) => { const s = stats(tasks.filter((t) => t.priority === p)); return [label(p), s.open, s.done]; }),
    (a, b) => ({ type: 'bar', title: 'Priority mix', cats: { col: 0, from: a, to: b }, at: { col: 4, row: a - 2, w: 8, h: 16 },
      series: [{ name: 'Open', vals: { col: 1, from: a, to: b }, color: COLORS.amber }, { name: 'Completed', vals: { col: 2, from: a, to: b }, color: COLORS.green }] }));
  const months = Array.from({ length: 12 }, (_, i) => { const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); m.setMonth(m.getMonth() - 11 + i); return m; });
  const inMonth = (s: string | null, m: Date) => { if (!s) return false; const x = new Date(s); return x.getFullYear() === m.getFullYear() && x.getMonth() === m.getMonth(); };
  block('Last 12 months', ['Month', 'Created', 'Completed'], months.map((m) => [m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    tasks.filter((t) => inMonth(t.created_at, m)).length, tasks.filter((t) => inMonth(t.completed_at, m)).length]),
    (a, b) => ({ type: 'line', title: 'Created vs completed per month', cats: { col: 0, from: a, to: b }, at: { col: 4, row: a - 2, w: 9, h: 16 },
      series: [{ name: 'Created', vals: { col: 1, from: a, to: b }, color: COLORS.blue }, { name: 'Completed', vals: { col: 2, from: a, to: b }, color: COLORS.green }] }));
  const summary: Sheet = { name: 'Summary', rows, charts, merges: sum.merges, tall: [0], widths: [26, 12, 12, 12, 4, 12, 12, 12, 12, 12, 12, 12, 12] };

  // ---------- People: each person's numbers + chart ----------
  const pp = banner('Performance by person', 9);
  const personRows = people.map((p) => ({ p, s: stats(tasks.filter((t) => t.tt_task_assignees.some((a) => a.user_id === p.id))) }))
    .filter((x) => x.s.total).sort((a, b) => b.s.done - a.s.done);
  const pTop = pp.rows.length + 1;
  pp.rows.push(head(['Person', 'Email', 'Role', 'Assigned', 'Open', 'Completed', 'Overdue', 'Completion', 'On time']),
    ...personRows.map(({ p, s }, i): Cell[] => {
      const z = i % 2 === 1;
      return [{ v: p.name, s: z ? 'zText' : 'text' }, { v: p.email, s: z ? 'zText' : 'text' }, { v: label(p.role), s: z ? 'zText' : 'text' },
        { v: s.total, s: z ? 'zNum' : 'num' }, { v: s.open, s: z ? 'zNum' : 'num' }, { v: s.done, s: z ? 'zNum' : 'num' },
        { v: s.overdue, s: s.overdue ? 'badText' : z ? 'zNum' : 'num' }, pct(s.rate), pct(s.onTime)];
    }));
  const pLast = pTop + personRows.length - 1;
  const peopleSheet: Sheet = { name: 'People', rows: pp.rows, merges: pp.merges, tall: [0], freeze: pTop, widths: [24, 30, 12, 11, 10, 12, 10, 12, 10],
    charts: personRows.length ? [{ type: 'bar', title: 'Open, completed and overdue by person', cats: { col: 0, from: pTop, to: pLast },
      at: { col: 10, row: 2, w: 9, h: Math.max(16, personRows.length * 2 + 4) },
      series: [{ name: 'Completed', vals: { col: 5, from: pTop, to: pLast }, color: COLORS.green }, { name: 'Open', vals: { col: 4, from: pTop, to: pLast }, color: COLORS.amber },
        { name: 'Overdue', vals: { col: 6, from: pTop, to: pLast }, color: COLORS.red }] }] : [] };

  // ---------- Departments ----------
  const dp = banner('Performance by department', 7);
  const dTop = dp.rows.length + 1;
  dp.rows.push(head(['Department', 'Tasks', 'Open', 'Completed', 'Overdue', 'Completion', 'On time']),
    ...byDept.map((x, i): Cell[] => { const z = i % 2 === 1; return [{ v: x.name, s: z ? 'zText' : 'text' }, { v: x.s.total, s: z ? 'zNum' : 'num' }, { v: x.s.open, s: z ? 'zNum' : 'num' },
      { v: x.s.done, s: z ? 'zNum' : 'num' }, { v: x.s.overdue, s: x.s.overdue ? 'badText' : z ? 'zNum' : 'num' }, pct(x.s.rate), pct(x.s.onTime)]; }));
  const dLast = dTop + byDept.length - 1;
  const deptSheet: Sheet = { name: 'Departments', rows: dp.rows, merges: dp.merges, tall: [0], freeze: dTop, widths: [26, 10, 10, 12, 10, 12, 10],
    charts: byDept.length ? [
      { type: 'col', title: 'Tasks by department', cats: { col: 0, from: dTop, to: dLast }, at: { col: 8, row: 2, w: 9, h: 16 },
        series: [{ name: 'Completed', vals: { col: 3, from: dTop, to: dLast }, color: COLORS.green }, { name: 'Open', vals: { col: 2, from: dTop, to: dLast }, color: COLORS.amber },
          { name: 'Overdue', vals: { col: 4, from: dTop, to: dLast }, color: COLORS.red }] },
      { type: 'doughnut', title: 'Share of all tasks', cats: { col: 0, from: dTop, to: dLast }, at: { col: 8, row: 19, w: 9, h: 16 },
        series: [{ name: 'Tasks', vals: { col: 1, from: dTop, to: dLast }, color: COLORS.green }] }] : [] };

  // ---------- All tasks ----------
  const tk = banner('All tasks', 10);
  const tTop = tk.rows.length;
  tk.rows.push(head(['Task', 'Status', 'Priority', 'Department', 'Assigned to', 'Created', 'Starts', 'Due', 'Completed', 'Overdue']),
    ...[...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((t, i): Cell[] => {
      const z = i % 2 === 1, tx: Style = z ? 'zText' : 'text', dt: Style = z ? 'zDate' : 'date', od = overdue(t);
      return [{ v: t.title, s: tx }, { v: label(t.status), s: STATUS_STYLE[t.status] ?? tx }, { v: label(t.priority), s: t.priority === 'urgent' ? 'badText' : tx },
        { v: deptName(t.department_id), s: tx }, { v: t.tt_task_assignees.map((a) => name(a.user_id)).join(', ') || 'Unassigned', s: tx },
        { v: d(t.created_at), s: dt }, { v: d(t.start_date), s: dt }, { v: d(t.due_date), s: dt }, { v: d(t.completed_at), s: dt }, { v: od ? 'Yes' : 'No', s: od ? 'bad' : z ? 'zNum' : 'num' }];
    }));
  const taskSheet: Sheet = { name: 'All tasks', rows: tk.rows, merges: tk.merges, tall: [0], freeze: tTop + 1, widths: [44, 20, 13, 20, 30, 14, 14, 14, 15, 12],
    filter: { row: tTop, cols: 10, last: tTop + tasks.length } };

  return buildXlsx([summary, peopleSheet, deptSheet, taskSheet]);
}
