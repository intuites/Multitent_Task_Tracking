import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Building2, CheckCircle2, Clock, Download, FolderKanban, PieChart, Repeat, Siren, Users, X, type LucideIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { projectProgress } from '../../api/_lib/progress';
import { TASK_STATUSES } from '../../api/_lib/taskStatus';
import { download, isOpen, isOverdue, label, usePeople } from '../lib/ui';
import { ListSkeleton } from '../components/Skeleton';
import { CountUp } from '../components/Liquid';

type Row = Record<string, string | number>;
type Report = 'task_completion' | 'overdue_work' | 'status_distribution' | 'employee_workload' | 'project_progress' | 'client_activity' | 'escalations' | 'recurring_tasks';
// each report: tab name, icon, and which column the bar chart plots (none = table only)
const REPORTS: { id: Report; name: string; icon: LucideIcon; bar?: string; max?: number }[] = [
  { id: 'task_completion', name: 'Completion', icon: CheckCircle2 },
  { id: 'status_distribution', name: 'Status', icon: PieChart, bar: 'Tasks' },
  { id: 'employee_workload', name: 'Workload', icon: Users, bar: 'Open' },
  { id: 'overdue_work', name: 'Overdue', icon: Clock },
  { id: 'project_progress', name: 'Projects', icon: FolderKanban, bar: 'Progress %', max: 100 },
  { id: 'client_activity', name: 'Clients', icon: Building2, bar: 'Tasks' },
  { id: 'escalations', name: 'Escalations', icon: Siren, bar: 'Raised' },
  { id: 'recurring_tasks', name: 'Recurring', icon: Repeat, bar: 'Occurrences' },
];
const STATUSES = TASK_STATUSES;
const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0);
const hrs = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 36e5;

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
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const { people, name } = usePeople(orgId);
  const [report, setReport] = useState<Report>('task_completion');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [client, setClient] = useState(''), [project, setProject] = useState(''), [emp, setEmp] = useState('');
  const [status, setStatus] = useState(''), [priority, setPriority] = useState(''), [sev, setSev] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [t, c, p, ms, es, ac] = await Promise.all([
        supabase.from('tt_tasks').select('id, title, status, priority, client_id, project_id, due_date, created_at, completed_at, recurrence_parent_id, tt_task_assignees(user_id)').eq('org_id', orgId).limit(5000),
        supabase.from('tt_clients').select('id, name').eq('org_id', orgId),
        supabase.from('tt_projects').select('id, name, progress_mode, manual_progress, client_id').eq('org_id', orgId),
        supabase.from('tt_project_milestones').select('project_id, completed_at').eq('org_id', orgId),
        supabase.from('tt_escalations').select('severity, state, raised_at, acknowledged_at, resolved_at, task_id').eq('org_id', orgId).limit(5000),
        supabase.from('tt_activity_logs').select('entity_type, entity_id, created_at').eq('org_id', orgId).eq('entity_type', 'client').limit(5000),
      ]);
      const err = [t, c, p, ms, es, ac].find((x) => x.error)?.error;
      if (err) setError(err.message);
      setData({ t: t.data ?? [], c: c.data ?? [], p: p.data ?? [], ms: ms.data ?? [], es: es.data ?? [], ac: ac.data ?? [] });
    })();
  }, [orgId]);

  const inRange = (d?: string | null) => (!from || (d ?? '') >= from) && (!to || (d ?? '') <= to + 'T23:59:59');
  const tasks = useMemo(() => (data?.t ?? []).filter((t: any) => inRange(t.created_at) && (!client || t.client_id === client) && (!project || t.project_id === project) &&
    (!status || t.status === status) && (!priority || t.priority === priority) && (!emp || t.tt_task_assignees.some((a: any) => a.user_id === emp))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, from, to, client, project, status, priority, emp]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const cname = (id: string) => data.c.find((c: any) => c.id === id)?.name ?? '—';
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
      case 'project_progress':
        return data.p.filter((p: any) => (!project || p.id === project) && (!client || p.client_id === client)).map((p: any) => ({
          Project: p.name, Client: cname(p.client_id), Basis: p.progress_mode === 'manual' ? 'manual entry' : `calculated (${p.progress_mode})`,
          'Progress %': projectProgress(p.progress_mode, p.manual_progress, data.ms.filter((m: any) => m.project_id === p.id), data.t.filter((t: any) => t.project_id === p.id)),
        }));
      case 'client_activity':
        return data.c.filter((c: any) => !client || c.id === client).map((c: any) => ({
          Client: c.name, Tasks: tasks.filter((t: any) => t.client_id === c.id).length, 'Open tasks': tasks.filter((t: any) => t.client_id === c.id && isOpen(t.status)).length,
          'Activity events': data.ac.filter((a: any) => a.entity_id === c.id && inRange(a.created_at)).length,
        }));
      case 'escalations': {
        const es = data.es.filter((e: any) => inRange(e.raised_at) && (!sev || e.severity === sev));
        return ['low', 'medium', 'high', 'critical'].filter((s) => !sev || s === sev).map((s) => {
          const m = es.filter((e: any) => e.severity === s);
          return { Severity: label(s), Raised: m.length, Open: m.filter((e: any) => !['resolved', 'closed'].includes(e.state)).length,
            'Avg hours to acknowledge': avg(m.filter((e: any) => e.acknowledged_at).map((e: any) => hrs(e.raised_at, e.acknowledged_at))),
            'Avg hours to resolve': avg(m.filter((e: any) => e.resolved_at).map((e: any) => hrs(e.raised_at, e.resolved_at))) };
        });
      }
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
  }, [data, tasks, report, sev, people, name]);

  const def = REPORTS.find((r) => r.id === report)!;
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const done = tasks.filter((t: any) => !isOpen(t.status)).length;
  const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const openEsc = (data?.es ?? []).filter((e: any) => !['resolved', 'closed'].includes(e.state) && inRange(e.raised_at)).length;
  const filtered = !!(from || to || client || project || emp || status || priority || sev);
  const clear = () => { setFrom(''); setTo(''); setClient(''); setProject(''); setEmp(''); setStatus(''); setPriority(''); setSev(''); };
  const val = (m: string) => Number(rows.find((r) => r.Metric === m)?.Value ?? 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">Reports</h2>
          <p className="page-sub">How work is moving across {membership!.org_name}. Filters apply to every report.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="pill-btn" onClick={() => download(`${report}.csv`, rows)} disabled={!rows.length}><Download size={16} aria-hidden="true" />Export CSV</button>
        </div>
      </div>

      <div className="rp-kpis">
        <div className="rp-kpi"><span className="rp-ico"><BarChart3 size={18} aria-hidden="true" /></span><small>Tasks in scope</small><b><CountUp value={tasks.length} /></b></div>
        <div className="rp-kpi"><span className="rp-ico ok"><CheckCircle2 size={18} aria-hidden="true" /></span><small>Completed</small><b><CountUp value={done} /></b><em>{rate}% completion</em></div>
        <div className="rp-kpi"><span className="rp-ico warn"><Clock size={18} aria-hidden="true" /></span><small>Overdue</small><b><CountUp value={tasks.filter(isOverdue).length} /></b></div>
        <div className="rp-kpi"><span className="rp-ico bad"><AlertTriangle size={18} aria-hidden="true" /></span><small>Open escalations</small><b><CountUp value={openEsc} /></b></div>
      </div>

      <section className="card rp-filters" aria-label="Filters">
        <div className="rp-dates">
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <select aria-label="Filter by client" value={client} onChange={(e) => setClient(e.target.value)}><option value="">All clients</option>{data?.c.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Filter by project" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{data?.p.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Filter by employee" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">All employees</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option>{['low', 'medium', 'high', 'urgent'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        {report === 'escalations' && <select aria-label="Filter by escalation severity" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">Any severity</option>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>}
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
      <p className="muted rp-note">Based on up to 5,000 most recent records per table. Dates use the browser time zone.</p>
    </>
  );
}
