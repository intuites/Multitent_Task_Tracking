import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { projectProgress } from '../../api/_lib/progress';
import { download, isOpen, isOverdue, label, usePeople } from '../lib/ui';

type Row = Record<string, string | number>;
const REPORTS = ['task_completion', 'overdue_work', 'status_distribution', 'employee_workload', 'project_progress', 'client_activity', 'escalations', 'recurring_tasks'];
const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0);
const hrs = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 36e5;

export default function Reports() {
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const { people, name } = usePeople(orgId);
  const [report, setReport] = useState(REPORTS[0]);
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [client, setClient] = useState(''), [project, setProject] = useState(''), [emp, setEmp] = useState('');
  const [status, setStatus] = useState(''), [priority, setPriority] = useState(''), [sev, setSev] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [t, c, p, ms, es, ap, ac] = await Promise.all([
        supabase.from('tt_tasks').select('id, title, status, priority, client_id, project_id, due_date, created_at, completed_at, recurrence_parent_id, tt_task_assignees(user_id)').eq('org_id', orgId).limit(5000),
        supabase.from('tt_clients').select('id, name').eq('org_id', orgId),
        supabase.from('tt_projects').select('id, name, progress_mode, manual_progress, client_id').eq('org_id', orgId),
        supabase.from('tt_project_milestones').select('project_id, completed_at').eq('org_id', orgId),
        supabase.from('tt_escalations').select('severity, state, raised_at, acknowledged_at, resolved_at, task_id').eq('org_id', orgId).limit(5000),
        supabase.from('tt_approvals').select('status, created_at, decided_at').eq('org_id', orgId).limit(5000),
        supabase.from('tt_activity_logs').select('entity_type, entity_id, created_at').eq('org_id', orgId).eq('entity_type', 'client').limit(5000),
      ]);
      const err = [t, c, p, ms, es, ap, ac].find((x) => x.error)?.error;
      if (err) setError(err.message);
      setData({ t: t.data ?? [], c: c.data ?? [], p: p.data ?? [], ms: ms.data ?? [], es: es.data ?? [], ap: ap.data ?? [], ac: ac.data ?? [] });
    })();
  }, [orgId]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const inRange = (d?: string | null) => (!from || (d ?? '') >= from) && (!to || (d ?? '') <= to + 'T23:59:59');
    const tasks = data.t.filter((t: any) => inRange(t.created_at) && (!client || t.client_id === client) && (!project || t.project_id === project) &&
      (!status || t.status === status) && (!priority || t.priority === priority) && (!emp || t.tt_task_assignees.some((a: any) => a.user_id === emp)));
    const cname = (id: string) => data.c.find((c: any) => c.id === id)?.name ?? '—';
    switch (report) {
      case 'task_completion': {
        const done = tasks.filter((t: any) => t.status === 'completed');
        const onTime = done.filter((t: any) => !t.due_date || t.completed_at <= t.due_date).length;
        return [{ Metric: 'Tasks in scope', Value: tasks.length }, { Metric: 'Completed', Value: done.length }, { Metric: 'Completed on time', Value: onTime },
          { Metric: 'Completed late', Value: done.length - onTime }, { Metric: 'Cancelled (not counted as completed)', Value: tasks.filter((t: any) => t.status === 'cancelled').length },
          { Metric: 'Completion rate %', Value: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0 }];
      }
      case 'overdue_work':
        return tasks.filter(isOverdue).map((t: any) => ({ Task: t.title, Status: label(t.status), Priority: label(t.priority), Due: t.due_date.slice(0, 10), Assignees: t.tt_task_assignees.map((a: any) => name(a.user_id)).join('; ') || 'Unassigned' }));
      case 'status_distribution':
        return Object.entries(tasks.reduce((m: any, t: any) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {})).map(([k, v]) => ({ Status: label(k), Tasks: v as number }));
      case 'employee_workload':
        return people.filter((p) => !emp || p.id === emp).map((p) => {
          const m = tasks.filter((t: any) => t.tt_task_assignees.some((a: any) => a.user_id === p.id));
          return { Employee: p.name, Open: m.filter((t: any) => isOpen(t.status)).length, Overdue: m.filter(isOverdue).length, Completed: m.filter((t: any) => t.status === 'completed').length };
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
          return { Template: data.t.find((t: any) => t.id === pid)?.title ?? '—', Occurrences: m.length, Completed: m.filter((t: any) => t.status === 'completed').length, Overdue: m.filter(isOverdue).length };
        });
      }
    }
    return [];
  }, [data, report, from, to, client, project, emp, status, priority, sev, people, name]);

  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="card">
      <div className="row"><h2>Reports</h2><button onClick={() => download(`${report}.csv`, rows)} disabled={!rows.length}>Export CSV</button></div>
      <div className="row filters">
        <select aria-label="Report" value={report} onChange={(e) => setReport(e.target.value)}>{REPORTS.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select>
        <label className="inline">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select aria-label="Filter by client" value={client} onChange={(e) => setClient(e.target.value)}><option value="">All clients</option>{data?.c.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Filter by project" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{data?.p.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Filter by employee" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">All employees</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['not_yet_started', 'in_progress', 'in_review', 'blocked', 'escalation', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option>{['low', 'medium', 'high', 'urgent'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select aria-label="Filter by escalation severity" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">Any escalation severity</option>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data ? <p>Loading…</p> : rows.length === 0 ? <p>No data for these filters.</p> : (
        <table><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{r[c]}</td>)}</tr>)}</tbody></table>)}
      <small>Based on up to 5,000 most recent records per table. Dates use the browser time zone.</small>
    </div>
  );
}
