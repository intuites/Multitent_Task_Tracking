import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { label, usePeople } from '../lib/ui';

interface Ev { date: string; text: string; link: string; kind: string }
const key = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// Month view only. Dates are shown in the browser's time zone.
export default function Calendar() {
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const { active } = usePeople(orgId);
  const [month, setMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [events, setEvents] = useState<Ev[]>([]);
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const from = new Date(month.getFullYear(), month.getMonth(), 1).toISOString();
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString();
    (async () => {
      const sel = assignee ? 'id, title, status, start_date, due_date, tt_task_assignees!inner(user_id)' : 'id, title, status, start_date, due_date';
      const base = () => {
        let q = supabase.from('tt_tasks').select(sel).eq('org_id', orgId).is('archived_at', null);
        if (assignee) q = q.eq('tt_task_assignees.user_id', assignee);
        if (priority) q = q.eq('priority', priority);
        if (status) q = q.eq('status', status);
        return q;
      };
      const [due, start, ms, esc] = await Promise.all([
        base().gte('due_date', from).lt('due_date', to).limit(500),
        base().gte('start_date', from).lt('start_date', to).limit(500),
        supabase.from('tt_project_milestones').select('id, title, due_date, project_id').eq('org_id', orgId).gte('due_date', from.slice(0, 10)).lt('due_date', to.slice(0, 10)),
        supabase.from('tt_escalations').select('id, target_date, tt_tasks(title)').eq('org_id', orgId).not('state', 'in', '(resolved,closed)').gte('target_date', from).lt('target_date', to),
      ]);
      const ev: Ev[] = [];
      for (const t of (due.data ?? []) as any[]) ev.push({ date: key(t.due_date), text: `Due: ${t.title}`, link: `/tasks/${t.id}`, kind: 'due' });
      for (const t of (start.data ?? []) as any[]) ev.push({ date: key(t.start_date), text: `Start: ${t.title}`, link: `/tasks/${t.id}`, kind: 'start' });
      for (const m of (ms.data ?? []) as any[]) ev.push({ date: m.due_date, text: `Milestone: ${m.title}`, link: `/projects/${m.project_id}`, kind: 'ms' });
      for (const e of (esc.data ?? []) as any[]) ev.push({ date: key(e.target_date), text: `Escalation target: ${e.tt_tasks?.title}`, link: '/escalations', kind: 'esc' });
      setEvents(ev);
    })();
  }, [orgId, month, assignee, priority, status]);

  const first = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => i - first + 1);

  return (
    <div className="card">
      <div className="row">
        <h2>Calendar — {month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <span>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>Prev</button>
          <button className="link" onClick={() => { const n = new Date(); setMonth(new Date(n.getFullYear(), n.getMonth(), 1)); }}>Today</button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next</button>
        </span>
      </div>
      <div className="row filters">
        <select aria-label="Filter by assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Any assignee</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option>{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['not_yet_started', 'in_progress', 'in_review', 'blocked', 'escalation', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <div className="agenda">
        {events.length === 0 ? <p>No events this month.</p> : (
          <ul className="plain">{[...events].sort((a, b) => a.date.localeCompare(b.date)).map((e, i) => (
            <li key={i}><b>{e.date}</b> <Link to={e.link}>{e.text}</Link></li>))}</ul>)}
      </div>
      <div className="cal">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <b key={d}>{d}</b>)}
        {cells.map((n, i) => {
          const inMonth = n >= 1 && n <= days;
          const k = inMonth ? key(new Date(month.getFullYear(), month.getMonth(), n)) : '';
          return (
            <div key={i} className={inMonth ? 'day' : 'day off'}>
              {inMonth && <span className="n">{n}</span>}
              {events.filter((e) => e.date === k).slice(0, 4).map((e, j) => <Link key={j} to={e.link} className={`ev ev-${e.kind}`}>{e.text}</Link>)}
              {events.filter((e) => e.date === k).length > 4 && <small>+{events.filter((e) => e.date === k).length - 4} more</small>}
            </div>);
        })}
      </div>
    </div>
  );
}
