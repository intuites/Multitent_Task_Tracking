import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, ChevronLeft, ChevronRight, Flag, PlayCircle, Siren, type LucideIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Badge, label, usePeople } from '../lib/ui';

type Kind = 'due' | 'start' | 'ms' | 'esc';
interface Ev { date: string; title: string; link: string; kind: Kind; status?: string }
const KINDS: Record<Kind, { name: string; icon: LucideIcon }> = {
  due: { name: 'Due', icon: Flag }, start: { name: 'Starts', icon: PlayCircle },
  ms: { name: 'Milestone', icon: CalendarCheck }, esc: { name: 'Escalation target', icon: Siren },
};
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const key = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const longDay = (k: string) => new Date(`${k}T00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

// Month view; dates are shown in the browser's time zone.
export default function Calendar() {
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const { active } = usePeople(orgId);
  const today = key(new Date());
  const [month, setMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [dir, setDir] = useState<1 | -1>(1);
  const [picked, setPicked] = useState(today);
  const [events, setEvents] = useState<Ev[] | null>(null);
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
      for (const t of (due.data ?? []) as any[]) ev.push({ date: key(t.due_date), title: t.title, link: `/tasks/${t.id}`, kind: 'due', status: t.status });
      for (const t of (start.data ?? []) as any[]) ev.push({ date: key(t.start_date), title: t.title, link: `/tasks/${t.id}`, kind: 'start', status: t.status });
      for (const m of (ms.data ?? []) as any[]) ev.push({ date: m.due_date, title: m.title, link: `/projects/${m.project_id}`, kind: 'ms' });
      for (const e of (esc.data ?? []) as any[]) ev.push({ date: key(e.target_date), title: e.tt_tasks?.title ?? 'Escalation', link: '/escalations', kind: 'esc' });
      setEvents(ev);
    })();
  }, [orgId, month, assignee, priority, status]);

  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of events ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [events]);

  const go = (step: 1 | -1 | 0) => {
    const n = new Date();
    const next = step ? new Date(month.getFullYear(), month.getMonth() + step, 1) : new Date(n.getFullYear(), n.getMonth(), 1);
    setDir(step === -1 || (step === 0 && next < month) ? -1 : 1);
    setMonth(next);
    setPicked(step ? key(next) : today);
  };

  const first = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => i - first + 1);
  const dayEvents = byDay.get(picked) ?? [];
  const upcoming = (events ?? []).filter((e) => e.date >= today && e.kind !== 'start').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const monthName = month.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">Calendar</h2>
          <p className="page-sub">Start dates, deadlines, milestones and escalation targets in one view.</p>
        </div>
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="Previous month"><ChevronLeft size={18} aria-hidden="true" /></button>
          <b aria-live="polite">{monthName}</b>
          <button type="button" className="icon-btn" onClick={() => go(1)} aria-label="Next month"><ChevronRight size={18} aria-hidden="true" /></button>
          <button type="button" className="pill-btn ghost" onClick={() => go(0)}>Today</button>
        </div>
      </div>

      <div className="cal-layout">
        <section className="card cal-card" aria-label={`${monthName} calendar`}>
          <div className="cal-tools">
            <div className="row filters">
              <select aria-label="Filter by assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Any assignee</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option>{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
              <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['not_yet_started', 'in_progress', 'in_review', 'blocked', 'escalation', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            </div>
            <ul className="cal-legend" aria-label="Legend">
              {(Object.keys(KINDS) as Kind[]).map((k) => <li key={k}><i className={`dot ev-${k}`} />{KINDS[k].name}</li>)}
            </ul>
          </div>

          <div className="cal-week" aria-hidden="true">{WEEK.map((d) => <b key={d}>{d}</b>)}</div>
          <div key={monthName} className={`cal-grid ${dir < 0 ? 'from-left' : 'from-right'}`}>
            {cells.map((n, i) => {
              if (n < 1 || n > days) return <div key={i} className="cal-cell off" aria-hidden="true" />;
              const k = key(new Date(month.getFullYear(), month.getMonth(), n));
              const evs = byDay.get(k) ?? [];
              const cls = ['cal-cell', k === today && 'today', k === picked && 'picked', (i % 7 === 0 || i % 7 === 6) && 'weekend', k < today && 'past'].filter(Boolean).join(' ');
              return (
                <button key={i} type="button" className={cls} onClick={() => setPicked(k)} aria-pressed={k === picked}
                  aria-label={`${longDay(k)}, ${evs.length ? `${evs.length} item${evs.length > 1 ? 's' : ''}` : 'nothing scheduled'}`}>
                  <span className="cal-n">{n}</span>
                  <span className="cal-evs">
                    {evs.slice(0, 3).map((e, j) => <span key={j} className={`ev ev-${e.kind}`}>{e.title}</span>)}
                    {evs.length > 3 && <span className="ev-more">+{evs.length - 3} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="cal-side">
          <section className="card cal-day" aria-labelledby="day-h">
            <p className="cal-eyebrow">{picked === today ? 'Today' : 'Selected day'}</p>
            <h3 id="day-h">{longDay(picked)}</h3>
            {events === null ? <p className="muted">Loading…</p> : dayEvents.length === 0 ? (
              <p className="muted cal-empty">Nothing scheduled. Pick another day to see its plan.</p>
            ) : (
              <ul key={picked} className="agenda-list">
                {dayEvents.map((e, i) => {
                  const K = KINDS[e.kind];
                  return (
                    <li key={i} style={{ '--i': i } as React.CSSProperties}>
                      <Link to={e.link} className={`agenda-item ev-${e.kind}`}>
                        <span className="agenda-ico"><K.icon size={16} aria-hidden="true" /></span>
                        <span className="agenda-text"><b>{e.title}</b><small>{K.name}</small></span>
                        {e.status && <Badge v={e.status} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="up-h">
            <h3 id="up-h">Coming up this month</h3>
            {upcoming.length === 0 ? <p className="muted">No more deadlines this month.</p> : (
              <ul className="up-list">
                {upcoming.map((e, i) => (
                  <li key={i}>
                    <button type="button" className="up-date" onClick={() => setPicked(e.date)} aria-label={`Show ${longDay(e.date)}`}>
                      <b>{new Date(`${e.date}T00:00`).getDate()}</b><small>{new Date(`${e.date}T00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</small>
                    </button>
                    <Link to={e.link} className="up-text"><b>{e.title}</b><small>{KINDS[e.kind].name}</small></Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
