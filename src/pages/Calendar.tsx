import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { pickName } from '../lib/names';
import { can } from '../../api/_lib/permissions';
import { useAuth } from '../lib/auth';
import { Badge, label, usePeople } from '../lib/ui';
import { TASK_STATUSES } from '../../api/_lib/taskStatus';
import { todayIn } from '../lib/greeting';
import { Count, Roll } from '../stageshow/kit/motion';
import './calendar.css';

/** A task on the calendar: one bar from its start to its due day (just one day when it has only one of the two). */
interface Ev { id: string; title: string; status: string; priority: string; start: string; end: string; hasStart: boolean; hasDue: boolean; people: string[] }
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANES = 3; // bars shown per week before "+N more"
const key = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const longDay = (k: string) => new Date(`${k}T00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (k: string) => new Date(`${k}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const DONE = ['completed', 'completed_cycle'];

// Month view. "Today" is the organization's day, like the top bar; task dates are calendar days.
export default function Calendar() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id;
  const { active, name } = usePeople(orgId);
  const today = todayIn(membership!.time_zone);
  const thisMonth = () => new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1);
  const [month, setMonth] = useState(thisMonth);
  const [dir, setDir] = useState<1 | -1>(1);
  const [picked, setPicked] = useState(today);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [peek, setPeek] = useState<{ ev: Ev; x: number; y: number; up: boolean } | null>(null);
  // the quick look waits a moment before it shows (sweeping across the grid shouldn't flash cards) and goes when the bar is left
  const peekTimer = useRef(0);
  useEffect(() => () => clearTimeout(peekTimer.current), []);

  useEffect(() => {
    const from = new Date(month.getFullYear(), month.getMonth(), 1).toISOString();
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString();
    (async () => {
      const sel = `id, title, status, priority, start_date, due_date, tt_task_assignees${assignee ? '!inner' : ''}(user_id)`;
      const base = () => {
        let q = supabase.from('tt_tasks').select(sel).eq('org_id', orgId).is('archived_at', null);
        if (assignee) q = q.eq('tt_task_assignees.user_id', assignee);
        if (priority) q = q.eq('priority', priority);
        if (status) q = q.eq('status', status);
        return q;
      };
      // due this month, starting this month, and running right through it
      const [due, start, across] = await Promise.all([
        base().gte('due_date', from).lt('due_date', to).limit(500),
        base().gte('start_date', from).lt('start_date', to).limit(500),
        base().lt('start_date', from).gte('due_date', to).limit(200),
      ]);
      const seen = new Map<string, Ev>();
      for (const t of [...(due.data ?? []), ...(start.data ?? []), ...(across.data ?? [])] as any[]) {
        if (seen.has(t.id)) continue;
        const s = t.start_date ? key(t.start_date) : null, d = t.due_date ? key(t.due_date) : null;
        // a start after the due date is a data slip, and a finished task's span is history: both show on the due day only
        const done = DONE.includes(t.status);
        const a = (s && d && s > d) || (done && d) ? d! : s ?? d!, b = d ?? s!;
        seen.set(t.id, { id: t.id, title: t.title, status: t.status, priority: t.priority, start: a, end: b, hasStart: !!s && a === s, hasDue: !!d,
          people: (t.tt_task_assignees ?? []).map((x: any) => x.user_id) });
      }
      // open work takes the lanes first; finished tasks fill what's left
      const rank = (e: Ev) => (DONE.includes(e.status) ? 1 : 0);
      setEvents([...seen.values()].sort((x, y) => rank(x) - rank(y) || x.start.localeCompare(y.start) || y.end.localeCompare(x.end)));
    })();
  }, [orgId, month, assignee, priority, status]);

  const go = (step: 1 | -1 | 0) => {
    const next = step ? new Date(month.getFullYear(), month.getMonth() + step, 1) : thisMonth();
    setDir(step === -1 || (step === 0 && next < month) ? -1 : 1);
    setMonth(next);
    setPicked(step ? key(next) : today);
    setPeek(null);
  };

  const first = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const total = Math.ceil((first + days) / 7) * 7;
  const dayKey = (i: number) => key(new Date(month.getFullYear(), month.getMonth(), i - first + 1));
  const monthName = month.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  // each week: its bars packed into lanes, plus how many didn't fit on each day
  const weeks = useMemo(() => {
    const out: { cells: number[]; bars: { ev: Ev; lane: number; c0: number; c1: number; capS: boolean; capE: boolean }[]; more: number[] }[] = [];
    for (let w = 0; w < total / 7; w++) {
      const cells = Array.from({ length: 7 }, (_, c) => w * 7 + c);
      const ws = dayKey(cells[0]), we = dayKey(cells[6]);
      const lanes: number[][] = [];
      const bars: typeof out[number]['bars'] = [];
      const more = Array(7).fill(0);
      for (const ev of events ?? []) {
        if (ev.end < ws || ev.start > we) continue;
        const s = ev.start < ws ? ws : ev.start, e = ev.end > we ? we : ev.end;
        const c0 = cells.findIndex((i) => dayKey(i) === s), c1 = cells.findIndex((i) => dayKey(i) === e);
        let lane = lanes.findIndex((l) => l.every((c) => c < c0 || c > c1));
        if (lane < 0) { lane = lanes.length; lanes.push([]); }
        for (let c = c0; c <= c1; c++) lanes[lane].push(c);
        if (lane < LANES) bars.push({ ev, lane, c0, c1, capS: s === ev.start, capE: e === ev.end });
        else for (let c = c0; c <= c1; c++) more[c]++;
      }
      out.push({ cells, bars, more });
    }
    return out;
  }, [events, month]); // eslint-disable-line react-hooks/exhaustive-deps

  // workload: open tasks due on each day
  const dueOn = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events ?? []) if (e.hasDue && !DONE.includes(e.status)) m.set(e.end, (m.get(e.end) ?? 0) + 1);
    return m;
  }, [events]);
  const busiest = Math.max(1, ...dueOn.values());

  const on = (k: string) => (events ?? []).filter((e) => e.start <= k && e.end >= k);
  const dayEvents = on(picked);
  // an empty day points at the next day that has work, so the panel is never a blank band
  const nextBusy = dayEvents.length ? null : (events ?? []).filter((e) => e.end > picked).map((e) => (e.start > picked ? e.start : e.end)).sort()[0] ?? null;
  const upcoming = (events ?? []).filter((e) => e.hasDue && e.end >= today && !DONE.includes(e.status)).sort((a, b) => a.end.localeCompare(b.end)).slice(0, 5);
  const role = (e: Ev, k: string) => (e.hasDue && e.end === k ? 'Due' : e.hasStart && e.start === k ? 'Starts' : 'Runs');
  const tone = (e: Ev) => (DONE.includes(e.status) ? 'done' : e.hasDue && e.end < today ? 'late' : e.status === 'pending' ? 'wait' : 'open');
  const PEEK_W = 230, PEEK_H = 104;
  const place = (ev: Ev, el: HTMLElement) => {
    const card = el.closest('.cal-card')!.getBoundingClientRect(), r = el.getBoundingClientRect();
    // above the bar when the window has room for it, otherwise below
    const up = r.top - PEEK_H - 8 > 70;
    setPeek({ ev, x: Math.max(8, Math.min(r.left - card.left, card.width - PEEK_W - 8)), y: up ? r.top - card.top - 8 : r.bottom - card.top + 8, up });
  };
  const show = (ev: Ev, el: HTMLElement, now = false) => {
    clearTimeout(peekTimer.current);
    if (now) return place(ev, el);
    peekTimer.current = window.setTimeout(() => place(ev, el), 320);
  };
  const hide = () => { clearTimeout(peekTimer.current); setPeek(null); };

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">Calendar</h2>
          <p className="page-sub">Start dates and deadlines in one view.</p>
        </div>
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="Previous month"><ChevronLeft size={18} aria-hidden="true" /></button>
          <b aria-live="polite"><Roll>{monthName}</Roll></b>
          <button type="button" className="icon-btn" onClick={() => go(1)} aria-label="Next month"><ChevronRight size={18} aria-hidden="true" /></button>
          <button type="button" className="pill-btn ghost" onClick={() => go(0)}>Today</button>
        </div>
      </div>

      <div className="cal-layout">
        <section className="card cal-card" aria-label={`${monthName} calendar`} onMouseLeave={hide}>
          <div className="cal-tools">
            <div className="row filters">
              {can(membership!.role, 'task:write') && <select aria-label="Filter by assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Any assignee</option>{active.map((p) => <option key={p.id} value={p.id}>{pickName(p, active, session?.user.id)}</option>)}</select>}
              <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option>{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
              <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            </div>
            <ul className="cal-legend" aria-label="Legend">
              <li><i className="cl-key open" />Open</li><li><i className="cl-key wait" />Pending</li><li><i className="cl-key late" />Overdue</li><li><i className="cl-key done" />Done</li>
            </ul>
          </div>

          <div className="cal-week" aria-hidden="true">{WEEK.map((d) => <b key={d}>{d}</b>)}</div>
          <div key={monthName} className={`cl-month ${dir < 0 ? 'from-left' : 'from-right'}`}>
            {weeks.map((w, wi) => (
              <div key={wi} className="cl-week" style={{ '--lanes': Math.min(LANES, Math.max(1, ...w.bars.map((b) => b.lane + 1))) } as React.CSSProperties}>
                {w.cells.map((i, c) => {
                  const n = i - first + 1;
                  if (n < 1 || n > days) return <div key={i} className="cl-day off" style={{ gridColumn: c + 1 }} aria-hidden="true" />;
                  const k = dayKey(i), load = dueOn.get(k) ?? 0, count = on(k).length;
                  const cls = ['cl-day', k === today && 'today', k === picked && 'picked', (c === 0 || c === 6) && 'weekend', k < today && 'past'].filter(Boolean).join(' ');
                  return (
                    <button key={i} type="button" className={cls} style={{ gridColumn: c + 1 }} onClick={() => setPicked(k)} aria-pressed={k === picked}
                      aria-label={`${longDay(k)}, ${count ? `${count} task${count > 1 ? 's' : ''}` : 'nothing scheduled'}${load ? `, ${load} due` : ''}`}>
                      <span className="cal-n">{n}</span>
                      {w.more[c] > 0 && <span className="cl-more">+{w.more[c]} more</span>}
                      {load > 0 && <span className="cl-load" aria-hidden="true"><i style={{ width: `${(load / busiest) * 100}%` }} /></span>}
                    </button>
                  );
                })}
                {w.bars.map(({ ev, lane, c0, c1, capS, capE }) => (
                  <Link key={ev.id} to={`/tasks/${ev.id}`} className={`cl-bar ${tone(ev)}${capS ? ' cap-s' : ''}${capE ? ' cap-e' : ''}${c0 === c1 ? ' one' : ''}`}
                    style={{ gridColumn: `${c0 + 1} / ${c1 + 2}`, gridRow: lane + 2 }}
                    onMouseEnter={(e) => show(ev, e.currentTarget)} onMouseLeave={hide} onFocus={(e) => show(ev, e.currentTarget, true)} onBlur={hide}
                    aria-label={`${ev.title}, ${label(ev.status)}${ev.hasStart ? `, starts ${shortDay(ev.start)}` : ''}${ev.hasDue ? `, due ${shortDay(ev.end)}` : ''}`}>
                    {capS && ev.hasStart && ev.start !== ev.end && <i className="cl-start" aria-hidden="true" />}<span>{ev.title}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>

          {peek && (
            <div className={`cl-peek${peek.up ? ' up' : ''}`} role="tooltip" style={{ left: peek.x, top: peek.y }}>
              <b>{peek.ev.title}</b>
              <span className="cl-peek-row"><Badge v={peek.ev.status} /><span className="cl-pri" data-p={peek.ev.priority}>{label(peek.ev.priority)}</span></span>
              <small>{peek.ev.hasStart && peek.ev.start !== peek.ev.end ? `Starts ${shortDay(peek.ev.start)} · ` : ''}{peek.ev.hasDue ? `Due ${shortDay(peek.ev.end)}` : `Starts ${shortDay(peek.ev.start)}`}</small>
              <small>{peek.ev.people.length ? peek.ev.people.map((p) => name(p)).join(', ') : 'Unassigned'}</small>
            </div>
          )}
        </section>

        <aside className="cal-side">
          <section className="card cal-day" aria-labelledby="day-h">
            <p className="cal-eyebrow">{picked === today ? 'Today' : 'Selected day'}</p>
            <h3 id="day-h">{longDay(picked)}</h3>
            {events === null ? <p className="muted">Loading…</p> : dayEvents.length ? (<>
              <p className="cl-sum"><Count value={dayEvents.length} /> {dayEvents.length === 1 ? 'task' : 'tasks'} on this day</p>
              <ul key={picked} className="agenda-list">
                {dayEvents.map((e, i) => (
                  <li key={e.id} style={{ '--i': i } as React.CSSProperties}>
                    <Link to={`/tasks/${e.id}`} className={`agenda-item cl-agenda ${tone(e)}`}>
                      <span className="cl-agenda-bar" aria-hidden="true" />
                      <span className="agenda-text"><b>{e.title}</b><small>{role(e, picked)}{e.hasStart && e.hasDue && e.start !== e.end ? ` · ${shortDay(e.start)} – ${shortDay(e.end)}` : ''}</small></span>
                      <Badge v={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </>) : nextBusy ? (
              <div className="cl-next">
                <p className="muted">Nothing on this day.</p>
                <button type="button" className="cl-next-btn" onClick={() => setPicked(nextBusy)}>
                  <span><small>Next with work</small><b>{longDay(nextBusy)}</b><small>{on(nextBusy).length} {on(nextBusy).length === 1 ? 'task' : 'tasks'}</small></span>
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            ) : <p className="muted cal-empty">Nothing scheduled for the rest of {month.toLocaleString('en-US', { month: 'long' })}.</p>}
          </section>

          <section className="card" aria-labelledby="up-h">
            <h3 id="up-h">Coming up this month</h3>
            {upcoming.length === 0 ? <p className="muted">No more deadlines this month.</p> : (
              <ul className="up-list">
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="up-date" onClick={() => setPicked(e.end)} aria-label={`Show ${longDay(e.end)}`}>
                      <b>{new Date(`${e.end}T00:00`).getDate()}</b><small>{new Date(`${e.end}T00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</small>
                    </button>
                    <Link to={`/tasks/${e.id}`} className="up-text"><b>{e.title}</b><small>Due{e.end === today ? ' today' : ''}</small></Link>
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
