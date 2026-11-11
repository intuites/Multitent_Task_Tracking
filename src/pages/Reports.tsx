import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Clock, Download, Hourglass, Layers, PieChart, Repeat, Users, X, type LucideIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { pickName } from '../lib/names';
import { useAuth } from '../lib/auth';
import { TASK_STATUSES } from '../../api/_lib/taskStatus';
import { fetchAll, fileStamp, isOpen, isOverdue, label, saveBlob, usePeople } from '../lib/ui';
import ReportExport, { type ExportChoice } from '../components/ReportExport';
import { ListSkeleton } from '../components/Skeleton';
import { CountUp } from '../components/Liquid';

type Row = Record<string, string | number>;
type Report = 'task_completion' | 'overdue_work' | 'status_distribution' | 'employee_workload' | 'departments' | 'recurring_tasks';
// each report: tab name, icon, and which column the bar chart plots (none = table only)
const REPORTS: { id: Report; name: string; icon: LucideIcon; bar?: string; max?: number }[] = [
  { id: 'task_completion', name: 'Completion', icon: CheckCircle2 },
  { id: 'status_distribution', name: 'Status', icon: PieChart, bar: 'Tasks' },
  { id: 'employee_workload', name: 'Workload', icon: Users, bar: 'Open' },
  { id: 'overdue_work', name: 'Overdue', icon: Clock },
  { id: 'departments', name: 'Departments', icon: Layers, bar: 'Tasks' },
  { id: 'recurring_tasks', name: 'Recurring', icon: Repeat, bar: 'Occurrences' },
];
const STATUSES = TASK_STATUSES.filter((s) => s !== 'escalation');
const TASK_COLS = 'id, org_id, title, description, created_by, parent_task_id, status, priority, department_id, due_date, start_date, created_at, completed_at, recurrence_parent_id, tt_task_assignees(user_id)';

function Ring({ pct }: { pct: number }) {
  return (
    <svg className="ring" viewBox="0 0 120 120" role="img" aria-label={`${pct}% completed`}>
      <circle cx="60" cy="60" r="50" pathLength={100} className="ring-track" />
      <circle cx="60" cy="60" r="50" pathLength={100} className="ring-fill" strokeDasharray={`${pct} 100`} />
      <text x="60" y="60" dominantBaseline="central" textAnchor="middle">{pct}%</text>
    </svg>
  );
}

function BarList({ rows, by, value, max }: { rows: Row[]; by: string; value: string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => Number(r[value]) || 0));
  return (
    <ul className="barlist">
      {[...rows].sort((a, b) => Number(b[value]) - Number(a[value])).map((r, i) => {
        const v = Number(r[value]) || 0;
        return (
          <li key={i} style={{ '--i': i } as React.CSSProperties}>
            <span className="bl-label">{r[by]}</span>
            <span className="bl-track"><i style={{ width: `${Math.max(v ? 3 : 0, (v / top) * 100)}%` }} /></span>
            <b>{v}{max === 100 ? '%' : ''}</b>
          </li>
        );
      })}
    </ul>
  );
}

export default function Reports() {
  const { membership, memberships, session } = useAuth();
  const [exporting, setExporting] = useState(false);
  const orgId = membership!.org_id;
  const { people, name } = usePeople(orgId);
  const [report, setReport] = useState<Report>('task_completion');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [dept, setDept] = useState(''), [emp, setEmp] = useState('');
  const [status, setStatus] = useState(''), [priority, setPriority] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [t, d] = await Promise.all([
        fetchAll(() => supabase.from('tt_tasks').select(TASK_COLS).eq('org_id', orgId).order('id')).then((data) => ({ data, error: null }), (e) => ({ data: [], error: e as Error })),
        supabase.from('tt_departments').select('id, name').eq('org_id', orgId).order('name'),
      ]);
      const err = [t, d].find((x) => x.error)?.error;
      if (err) setError(err.message);
      setData({ t: t.data ?? [], d: d.data ?? [] });
    })();
  }, [orgId]);

  const inRange = (d?: string | null) => (!from || (d ?? '') >= from) && (!to || (d ?? '') <= to + 'T23:59:59');
  // here: also the department and employee filters, which only mean something in this organization
  const match = (t: any, here = true) => inRange(t.created_at) && (!status || t.status === status) && (!priority || t.priority === priority) &&
    (!here || ((!dept || t.department_id === dept) && (!emp || t.tt_task_assignees.some((a: any) => a.user_id === emp))));
  const tasks = useMemo(() => (data?.t ?? []).filter((t: any) => match(t)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, from, to, dept, status, priority, emp]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    switch (report) {
      case 'task_completion': {
        const done = tasks.filter((t: any) => !isOpen(t.status));
        const onTime = done.filter((t: any) => !t.due_date || t.completed_at <= t.due_date).length;
        return [{ Metric: 'Tasks in scope', Value: tasks.length }, { Metric: 'Completed', Value: done.length }, { Metric: 'Completed on time', Value: onTime },
          { Metric: 'Completed late', Value: done.length - onTime },
          { Metric: 'Completion rate %', Value: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0 }];
      }
      case 'overdue_work':
        return tasks.filter(isOverdue).map((t: any) => ({ Task: t.title, Status: label(t.status), Priority: label(t.priority), Due: t.due_date.slice(0, 10), Assignees: t.tt_task_assignees.map((a: any) => name(a.user_id)).join('; ') || 'Unassigned' }));
      case 'status_distribution':
        return Object.entries(tasks.reduce((m: any, t: any) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {})).map(([k, v]) => ({ Status: label(k), Tasks: v as number }));
      case 'employee_workload':
        return people.filter((p) => !emp || p.id === emp).map((p) => {
          const m = tasks.filter((t: any) => t.tt_task_assignees.some((a: any) => a.user_id === p.id));
          return { Employee: p.name, Open: m.filter((t: any) => isOpen(t.status)).length, Overdue: m.filter(isOverdue).length, Completed: m.filter((t: any) => !isOpen(t.status)).length };
        }).filter((r) => r.Open + r.Completed > 0);
      case 'departments':
        return [...data.d, { id: null, name: 'No department' }].filter((d: any) => !dept || d.id === dept).map((d: any) => {
          const m = tasks.filter((t: any) => (t.department_id ?? null) === d.id);
          return { Department: d.name, Tasks: m.length, Open: m.filter((t: any) => isOpen(t.status)).length, Completed: m.filter((t: any) => !isOpen(t.status)).length, Overdue: m.filter(isOverdue).length };
        }).filter((r: Row) => Number(r.Tasks) > 0);
      case 'recurring_tasks': {
        const occ = tasks.filter((t: any) => t.recurrence_parent_id);
        const parents = [...new Set(occ.map((t: any) => t.recurrence_parent_id))];
        return parents.map((pid) => {
          const m = occ.filter((t: any) => t.recurrence_parent_id === pid);
          return { Template: data.t.find((t: any) => t.id === pid)?.title ?? '—', Occurrences: m.length, Completed: m.filter((t: any) => !isOpen(t.status)).length, Overdue: m.filter(isOverdue).length };
        });
      }
    }
    return [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tasks, report, dept, people, name]);

  const def = REPORTS.find((r) => r.id === report)!;
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const done = tasks.filter((t: any) => !isOpen(t.status)).length;
  const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const filtered = !!(from || to || dept || emp || status || priority);
  const clear = () => { setFrom(''); setTo(''); setDept(''); setEmp(''); setStatus(''); setPriority(''); };
  const platform = !!membership!.platform;
  const fl = (here: boolean) => {
    const f = [from && `from ${from}`, to && `to ${to}`, here && dept && (data?.d.find((x: any) => x.id === dept)?.name ?? ''), here && emp && name(emp), status && label(status), priority && `${label(priority)} priority`].filter(Boolean);
    return f.length ? `Filters: ${f.join(', ')}` : 'All tasks';
  };
  // the filtered tasks of this organization, or (platform admins) of the organizations picked
  async function exportAs({ parts, format, orgIds }: ExportChoice) {
    const r = await import('../lib/reportWorkbook');
    const pdf = format === 'pdf' ? (await import('../lib/printReport')).printReport : null;
    if (orgIds.length === 1 && orgIds[0] === orgId) {
      const input = { org: membership!.org_name, filters: fl(true), tasks, depts: data.d, people, label, parts, all: data.t };
      if (pdf) pdf(r.reportPdf(input)); else saveBlob(`${fileStamp(`${membership!.org_name}_report`)}.xlsx`, r.reportWorkbook(input));
      return;
    }
    // reads go through RLS, which lets platform admins see every organization
    const [orgs, members, profiles, depts, all] = await Promise.all([
      fetchAll(() => supabase.from('tt_organizations').select('id, name, created_at').in('id', orgIds).order('id')),
      fetchAll(() => supabase.from('tt_org_members').select('org_id, user_id, role, active').in('org_id', orgIds).order('org_id').order('user_id')),
      fetchAll(() => supabase.from('tt_profiles').select('user_id, full_name, email').order('user_id')),
      fetchAll(() => supabase.from('tt_departments').select('id, org_id, name').in('org_id', orgIds).order('id')),
      fetchAll(() => supabase.from('tt_tasks').select(TASK_COLS).in('org_id', orgIds).is('archived_at', null).order('id')),
    ]);
    const input = { orgs, members, profiles, depts, tasks: all.filter((t: any) => match(t, false)), all, label, parts, filters: fl(false) };
    if (pdf) pdf(r.platformPdf(input)); else saveBlob(`${fileStamp(orgs.length === 1 ? `${orgs[0].name}_report` : 'Taskify_organizations')}.xlsx`, r.platformWorkbook(input));
  }
  const val = (m: string) => Number(rows.find((r) => r.Metric === m)?.Value ?? 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">Reports</h2>
          <p className="page-sub">How work is moving across {membership!.org_name}. Filters apply to every report.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="pill-btn" onClick={() => setExporting(true)} disabled={!data}><Download size={16} aria-hidden="true" />Export</button>
        </div>
      </div>
      <ReportExport open={exporting} onClose={() => setExporting(false)} onExport={exportAs} current={orgId}
        orgs={platform ? memberships.map((m) => ({ id: m.org_id, name: m.org_name })) : undefined}
        note={!filtered ? 'Covers every task. To narrow it, set filters on the page first.'
          : `Uses the filters on screen: ${fl(true).replace(/^Filters: /, '')}.${platform && (dept || emp) ? ` Department and employee filters apply to ${membership!.org_name} only.` : ''}`} />

      <div className="rp-kpis">
        <div className="rp-kpi"><span className="rp-ico"><BarChart3 size={18} aria-hidden="true" /></span><small>Tasks in scope</small><b><CountUp value={tasks.length} /></b></div>
        <div className="rp-kpi"><span className="rp-ico ok"><CheckCircle2 size={18} aria-hidden="true" /></span><small>Completed</small><b><CountUp value={done} /></b><em>{rate}% completion</em></div>
        <div className="rp-kpi"><span className="rp-ico warn"><Clock size={18} aria-hidden="true" /></span><small>Overdue</small><b><CountUp value={tasks.filter(isOverdue).length} /></b></div>
        <div className="rp-kpi"><span className="rp-ico bad"><Hourglass size={18} aria-hidden="true" /></span><small>Pending</small><b><CountUp value={tasks.filter((t: any) => t.status === 'pending').length} /></b></div>
      </div>

      <section className="card rp-filters" aria-label="Filters">
        <div className="rp-dates">
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <select aria-label="Filter by department" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{data?.d.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select aria-label="Filter by employee" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">All employees</option>{people.map((p) => <option key={p.id} value={p.id}>{pickName(p, people, session?.user.id)}</option>)}</select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option>{['low', 'medium', 'high', 'urgent'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        {filtered && <button type="button" className="link" onClick={clear}><X size={15} aria-hidden="true" />Clear filters</button>}
      </section>

      <div className="rp-tabs" role="tablist" aria-label="Report">
        {REPORTS.map((r) => (
          <button key={r.id} type="button" role="tab" aria-selected={report === r.id} className={report === r.id ? 'on' : ''} onClick={() => setReport(r.id)}>
            <r.icon size={16} aria-hidden="true" />{r.name}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="form-alert">{error}</p>}
      <section key={report} className="card rp-body" aria-label={label(report)}>
        {!data ? <ListSkeleton /> : rows.length === 0 ? (
          <div className="rp-empty"><BarChart3 size={28} aria-hidden="true" /><p>No data for these filters.</p>{filtered && <button type="button" className="pill-btn ghost" onClick={clear}>Clear filters</button>}</div>
        ) : (<>
          {report === 'task_completion' ? (
            <div className="rp-completion">
              <Ring pct={val('Completion rate %')} />
              <div className="rp-tiles">
                {rows.filter((r) => r.Metric !== 'Completion rate %').map((r) => <div key={r.Metric} className="rp-tile"><b>{r.Value}</b><small>{r.Metric}</small></div>)}
              </div>
            </div>
          ) : def.bar ? (
            <BarList rows={rows} by={cols[0]} value={def.bar} max={def.max} />
          ) : null}
          {report !== 'task_completion' && (
            <details className="rp-table" open={!def.bar}>
              <summary>{def.bar ? 'Show details' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}</summary>
              <table><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{r[c]}</td>)}</tr>)}</tbody></table>
            </details>
          )}
        </>)}
      </section>
      <p className="muted rp-note">Covers every task in this organization. Dates use the browser time zone.</p>
    </>
  );
}
