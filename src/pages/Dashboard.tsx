import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BarChart3, CalendarClock, CalendarRange, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, fetchAll, fmt, fmtTime, rpc, usePeople } from '../lib/ui';
import { Avatar } from '../components/Frame';
import { CountUp, LiquidBg } from '../components/Liquid';
import { DashSkeleton } from '../components/Skeleton';
import { useLive } from '../lib/live';
import { countTasks, PERIODS, type Period } from '../lib/dashPeriod';

/** 3D: the card under the pointer tilts toward it and lifts. Uses the `rotate` and `translate` properties, so it never
 *  fights the cards' `transform` animations. Skipped on touch and reduced motion. */
function useTilt(root: React.RefObject<HTMLElement>, ready: boolean) {
  useEffect(() => {
    const el = root.current;
    if (!el || !ready || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(pointer: fine)').matches) return;
    let raf = 0, last: PointerEvent | null = null, cur: HTMLElement | null = null;
    const reset = (c: HTMLElement) => { c.style.rotate = ''; c.style.translate = ''; c.removeAttribute('data-tilt'); };
    const frame = () => {
      raf = 0;
      const e = last!, hit = (e.target as Element).closest<HTMLElement>('.dash .kpi, .dash > .card');
      if (cur && cur !== hit) reset(cur);
      cur = hit;
      if (!hit) return;
      const r = hit.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      // big cards tilt less, so their text stays readable
      const max = r.width > 500 ? 4 : 9, ang = Math.hypot(x, y) * 2 * max;
      hit.style.rotate = `${(-y).toFixed(3)} ${x.toFixed(3)} 0 ${ang.toFixed(2)}deg`;
      hit.style.translate = '0 0 24px';
      hit.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
      hit.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
      hit.style.setProperty('--dx', x.toFixed(3));
      hit.style.setProperty('--dy', y.toFixed(3));
      hit.setAttribute('data-tilt', '');
    };
    const move = (e: PointerEvent) => { last = e; if (!raf) raf = requestAnimationFrame(frame); };
    const leave = () => { if (cur) reset(cur); cur = null; };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); cancelAnimationFrame(raf); if (cur) reset(cur); };
  }, [root, ready]);
}

const OPEN = '(completed,completed_cycle)';
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Kpi({ title, value, note, to, feature }: { title: string; value: number; note: string; to: string; feature?: boolean }) {
  return (
    <Link to={to} className={feature ? 'kpi feature' : 'kpi'}>
      {feature && <LiquidBg />}
      <span className="kpi-head"><span>{title}</span><span className="go" aria-hidden="true"><ArrowUpRight size={16} /></span></span>
      <b><CountUp value={value} /></b>
      <small>{note}</small>
    </Link>
  );
}

type Range = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';
const RANGES: [Range, string][] = [['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['custom', 'Custom']];
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addD = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** [from, to) for a preset range, in the viewer's local time. */
function bounds(r: Range, cFrom: string, cTo: string): [Date, Date] {
  const t = day0(new Date()), sun = addD(t, -t.getDay());
  if (r === 'this_week') return [sun, addD(sun, 7)];
  if (r === 'last_week') return [addD(sun, -7), sun];
  if (r === 'this_month') return [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 1)];
  if (r === 'last_month') return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 1)];
  const f = cFrom ? new Date(`${cFrom}T00:00:00`) : addD(t, -13), to = cTo ? addD(new Date(`${cTo}T00:00:00`), 1) : addD(t, 1);
  return f < to ? [f, to] : [to, f];
}

/** Buckets: a bar per day up to 2 weeks, per week up to ~4 months, otherwise per month. */
function buckets(from: Date, to: Date) {
  const days = Math.round((to.getTime() - from.getTime()) / 864e5), out: { start: Date; end: Date; label: string; title: string }[] = [];
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  if (days <= 14) {
    for (let d = from; d < to; d = addD(d, 1))
      out.push({ start: d, end: addD(d, 1), label: days <= 7 ? DAYS[d.getDay()] : md(d), title: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) });
  } else if (days <= 120) {
    for (let d = from; d < to; d = addD(d, 7)) {
      const e = addD(d, 7) < to ? addD(d, 7) : to;
      out.push({ start: d, end: e, label: md(d), title: `${md(d)} – ${md(addD(e, -1))}` });
    }
  } else {
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1))
      out.push({ start: d < from ? from : d, end: new Date(d.getFullYear(), d.getMonth() + 1, 1), label: d.toLocaleDateString('en-US', { month: 'short' }), title: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

// Completed tasks over a chosen range, a labelled bar per day / week / month: the signed-in person's, or (uid null) the whole organization's.
function CompletedChart({ orgId, uid, tick, reports, period }: { orgId: string; uid: string | null; tick: number; reports: boolean; period: Period }) {
  const [range, setRange] = useState<Range>('this_week');
  const [cFrom, setCFrom] = useState(''), [cTo, setCTo] = useState('');
  // the dashboard filter moves the chart to the same period (all time: the last 12 months, a bar per month); its own tabs still work
  useEffect(() => {
    if (period === 'week') setRange('this_week');
    else if (period === 'month') setRange('this_month');
    else { const t = new Date(); setRange('custom'); setCFrom(isoDay(new Date(t.getFullYear() - 1, t.getMonth() + 1, 1))); setCTo(''); }
  }, [period]);
  const [dates, setDates] = useState<number[] | null>(null);
  const [from, to] = bounds(range, cFrom, cTo);
  const key = `${from.getTime()}-${to.getTime()}`;
  useEffect(() => {
    let live = true;
    setDates(null);
    const q = supabase.from('tt_tasks').select(uid ? 'completed_at, tt_task_assignees!inner(user_id)' : 'completed_at').eq('org_id', orgId);
    (uid ? q.eq('tt_task_assignees.user_id', uid) : q).is('archived_at', null).in('status', ['completed', 'completed_cycle']).gte('completed_at', from.toISOString()).lt('completed_at', to.toISOString()).limit(10000)
      .then(({ data }) => { if (live) setDates((data ?? []).map((r: any) => Date.parse(r.completed_at))); });
    return () => { live = false; };
  }, [orgId, uid, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const bs = buckets(from, to), now = Date.now();
  const counts = bs.map((b) => (dates ?? []).filter((t) => t >= b.start.getTime() && t < b.end.getTime()).length);
  const max = Math.max(1, ...counts), best = counts.indexOf(Math.max(...counts)), total = counts.reduce((a, b) => a + b, 0);
  const title = range === 'custom' ? `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${addD(to, -1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : RANGES.find(([r]) => r === range)![1];

  return (<>
    <div className="cc-head">
      <div><h3 id="an-h">{uid ? 'My completed tasks' : 'Completed by the team'}</h3><small className="muted">{dates === null ? 'Loading…' : `${total} in ${range === 'custom' ? title : title.toLowerCase()}`}</small></div>
      {/* employees can't open Reports; the link would only bounce them back here */}
      <span className="cc-tools">
        {/* the same dropdown style as the page's period filter */}
        <label className="dash-period cc-period">
          <CalendarRange size={15} aria-hidden="true" />
          <span className="sr-only">Date range</span>
          <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {RANGES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
          </select>
        </label>
        {reports && <Link to="/reports" className="mini-link"><BarChart3 size={15} aria-hidden="true" />Reports</Link>}
      </span>
    </div>
    {range === 'custom' && (
      <div className="cc-custom">
        <label>From<input type="date" value={cFrom || isoDay(from)} max={isoDay(new Date())} onChange={(e) => setCFrom(e.target.value)} /></label>
        <label>To<input type="date" value={cTo || isoDay(addD(to, -1))} onChange={(e) => setCTo(e.target.value)} /></label>
      </div>)}
    <div key={key} className={`weekbars cc-bars ${bs.length > 10 ? 'dense' : ''}`} style={{ gridTemplateColumns: `repeat(${bs.length}, 1fr)` }}
      role="img" aria-label={`Tasks completed, ${title}: ${bs.map((b, i) => `${b.title} ${counts[i]}`).join(', ')}`}>
      {bs.map((b, i) => {
        const c = counts[i], future = b.start.getTime() > now, current = b.start.getTime() <= now && now < b.end.getTime();
        const cls = future ? 'bar future' : c === 0 ? 'bar zero' : current ? 'bar today' : i === best ? 'bar best' : 'bar';
        return (
          <div key={b.start.getTime()} className="bar-col" style={{ '--i': i } as React.CSSProperties} title={`${b.title}: ${c} completed`}>
            <div className="bar-track">
              <span className="bar-stack" style={{ height: future ? '100%' : c === 0 ? '8%' : `${Math.max(16, (c / max) * 100)}%` }}>
                {!future && dates !== null && <span className={`bar-val ${current ? 'now' : ''}`}>{c}</span>}
                <span className={cls} />
              </span>
            </div>
            <span className={`bar-day ${current ? 'now' : ''}`}>{b.label}</span>
          </div>
        );
      })}
    </div>
  </>);
}

// Half-donut of completed / in progress / pending, drawn with dash offsets on one arc.
function Gauge({ done, active, pending }: { done: number; active: number; pending: number }) {
  const total = done + active + pending;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const seg = (n: number) => (total ? (n / total) * 100 : 0);
  const arc = 'M 20 110 A 90 90 0 0 1 200 110';
  return (
    <div className="gauge">
      <svg viewBox="0 0 220 125" role="img" aria-label={`${pct}% of tasks completed: ${done} completed, ${active} started, ${pending} not started or pending`}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--hatch-bg)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" strokeWidth="2.5" />
          </pattern>
        </defs>
        <path d={arc} pathLength={100} fill="none" stroke="url(#hatch)" strokeWidth="28" />
        <path d={arc} pathLength={100} fill="none" stroke="var(--brand-3)" strokeWidth="28" strokeDasharray={`${seg(done) + seg(active)} 100`} />
        <path d={arc} pathLength={100} fill="none" stroke="var(--brand)" strokeWidth="28" strokeDasharray={`${seg(done)} 100`} />
      </svg>
      <div className="gauge-num"><b>{total ? `${pct}%` : '—'}</b><small>{total ? `${done} of ${total} tasks done` : 'No tasks yet'}</small></div>
      <ul className="legend">
        <li><i className="sw done" />Completed <b>{done}</b></li><li><i className="sw active" />Started <b>{active}</b></li><li><i className="sw pending" />Pending <b>{pending}</b></li>
      </ul>
    </div>
  );
}

export default function Dashboard() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id;
  const canAssign = can(membership!.role, 'task:write');
  // platform admins are never assigned tasks (they belong to no organization), so they see the open organization's totals
  const all = !!membership!.platform;
  const tasks = all ? '/tasks' : '/my-tasks';
  const { name, photo } = usePeople(orgId);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  // remembered per browser
  const [period, setPeriodState] = useState<Period>(() => { try { const v = localStorage.getItem('tt-dash-period'); return v === 'week' || v === 'month' ? v : 'all'; } catch { return 'all'; } });
  const setPeriod = (p: Period) => { setPeriodState(p); try { localStorage.setItem('tt-dash-period', p); } catch { /* storage blocked */ } };

  // live: reload when any task in this org changes (and on the clock every 2 minutes, so "due today" stays right)
  useLive(['tt_tasks', 'tt_task_assignees'], () => setTick((n) => n + 1));
  useEffect(() => {
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') setTick((n) => n + 1); }, 120_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      // the person's own tasks (what My Tasks shows); a platform admin's: every task in the organization
      const myTasks = (cols: string) => {
        const q = supabase.from('tt_tasks').select(all ? cols : `${cols}, tt_task_assignees!inner(user_id)`).eq('org_id', orgId);
        return (all ? q : q.eq('tt_task_assignees.user_id', uid)).is('archived_at', null);
      };
      try {
        const [sum, myAll, next, current, mine] = await Promise.all([
          rpc('tt_org_summary', { p_org: orgId, p_day_start: start.toISOString(), p_day_end: end.toISOString() }),
          fetchAll(() => myTasks('id, status, due_date, completed_at').order('id')).then((data) => ({ data })),
          myTasks('id, title, status, due_date').not('status', 'in', OPEN).gte('due_date', now.toISOString()).order('due_date').limit(1),
          supabase.from('tt_tasks').select('id, title, status, tt_task_assignees(user_id)').eq('org_id', orgId).is('archived_at', null)
            .in('status', ['started', 'pending', 'not_yet_started']).order('updated_at', { ascending: false }).limit(100),
          supabase.from('tt_tasks').select('id, title, status, due_date, tt_task_assignees!inner(user_id)').eq('org_id', orgId).eq('tt_task_assignees.user_id', uid)
            .is('archived_at', null).not('status', 'in', OPEN).order('due_date', { nullsFirst: false }).limit(4),
        ]);
        // one "currently working on" task per person, most recently updated first
        const working = new Map<string, any>();
        for (const t of current.data ?? []) for (const a of t.tt_task_assignees) if (!working.has(a.user_id)) working.set(a.user_id, t);
        setD({
          sum, next: next.data?.[0], mine: mine.data ?? [],
          team: (sum.workload as any[]).filter((w) => w.open).slice(0, 4).map((w) => ({ ...w, task: working.get(w.user_id) })),
          // every number is the signed-in person's own tasks (a platform admin's: the organization's), counted for the period below
          rows: myAll.data ?? [],
        });
      } catch (x) { setError((x as Error).message); }
    })();
  }, [orgId, uid, tick, all]);

  // recounted when the filter changes, without reloading; the clock tick keeps "overdue" and "due today" current
  const c = useMemo(() => countTasks(d?.rows ?? [], period), [d, period, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const dashRef = useRef<HTMLDivElement>(null);
  useTilt(dashRef, !!d);
  if (error) return <div className="card"><p role="alert">{error}</p></div>;
  if (!d) return <DashSkeleton />;
  const span = period === 'week' ? 'this week' : period === 'month' ? 'this month' : '';

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-sub">{all ? `How ${membership!.org_name} is doing today, across every task.` : 'What needs your attention today.'}</p>
        </div>
        <div className="page-actions">
          {/* open, overdue and pending count tasks due in the period; completed counts tasks finished in it */}
          <label className="dash-period" title={span ? `Tasks due ${span}; Completed counts tasks finished ${span}` : 'Every task, whenever it is due'}>
            <CalendarRange size={16} aria-hidden="true" />
            <span className="sr-only">Show tasks for</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {PERIODS.map(([p, l]) => <option key={p} value={p}>{l}</option>)}
            </select>
          </label>
          {canAssign && <Link to="/tasks?new=1" className="pill-btn"><Plus size={16} aria-hidden="true" />Add task</Link>}
          {can(membership!.role, 'report:read') && <Link to="/reports" className="pill-btn ghost">View reports</Link>}
        </div>
      </div>

      <div className="dash" ref={dashRef}>
        <div className="a-k1"><Kpi feature title={all ? 'Open tasks' : 'My open tasks'} value={c.open} note={span ? `Due ${span} · ${c.active} started` : `${c.active} started`} to={tasks} /></div>
        <div className="a-k2"><Kpi title="Overdue" value={c.overdue} note={c.overdue ? 'Past their due date' : 'Everything is on time'} to={`${tasks}?view=overdue`} /></div>
        <div className="a-k3"><Kpi title="Due today" value={c.dueToday} note="Before midnight" to={`${tasks}?view=due_today`} /></div>
        <div className="a-k4"><Kpi title="Pending" value={c.waiting} note="Waiting on something" to={`${tasks}?view=pending`} /></div>

        <section className="card a-an" aria-labelledby="an-h">
          <CompletedChart orgId={orgId} uid={all ? null : uid} tick={tick} reports={can(membership!.role, 'report:read')} period={period} />
        </section>

        <section className="card a-re" aria-labelledby="re-h">
          <h3 id="re-h">Next deadline</h3>
          {d.next ? (<>
            <p className="remind-title">{d.next.title}</p>
            <p className="remind-time">Due {fmtTime(d.next.due_date)}</p>
            <Link to={`/tasks/${d.next.id}`} className="pill-btn wide"><CalendarClock size={16} aria-hidden="true" />Open task</Link>
          </>) : <p className="muted">No upcoming deadlines.</p>}
        </section>

        <section className="card a-tm" aria-labelledby="tm-h">
          {canAssign ? (<>
            <div className="panel-head"><h3 id="tm-h">Team at work</h3>{can(membership!.role, 'members:manage') && <Link to="/employees" className="pill-btn ghost sm"><Plus size={14} aria-hidden="true" />Add member</Link>}</div>
            {d.team.length === 0 ? <p className="muted">Nobody has open work assigned.</p> : (
              <ul className="team">{d.team.map((w: any) => (
                <li key={w.user_id}><Avatar name={name(w.user_id)} url={photo(w.user_id)} />
                  <span className="who"><b>{name(w.user_id)}</b><small>{w.task ? <>Working on <Link to={`/tasks/${w.task.id}`}>{w.task.title}</Link></> : `${w.open} open tasks`}</small></span>
                  {w.task && <Badge v={w.task.status} />}</li>))}
              </ul>)}
          </>) : (<>
            <div className="panel-head"><h3 id="tm-h">My tasks</h3><Link to="/my-tasks" className="mini-link">View all</Link></div>
            {d.mine.length === 0 ? <p className="muted">Nothing assigned to you.</p> : (
              <ul className="team">{d.mine.map((t: any) => (
                <li key={t.id}><span className="who"><Link to={`/tasks/${t.id}`}><b>{t.title}</b></Link><small>Due {fmt(t.due_date)}</small></span><Badge v={t.status} /></li>))}
              </ul>)}
          </>)}
        </section>

        <section className="card a-pg" aria-labelledby="pg-h">
          <h3 id="pg-h">{all ? 'Task progress' : 'My task progress'}</h3>
          <Gauge done={c.done} active={c.active} pending={c.pending} />
        </section>

        <section className="card esc-card a-es" aria-labelledby="es-h">
          <LiquidBg tone="deep" />
          <h3 id="es-h">Completed</h3>
          <b className="esc-num"><CountUp value={c.done} /></b>
          <p>{span ? `Finished ${span}: ` : ''}{c.cycle} this cycle · {c.done - c.cycle} permanently</p>
          <Link to={`${tasks}?view=completed`} className="round-btn" aria-label={all ? 'Open completed tasks' : 'Open my completed tasks'}><ArrowUpRight size={20} aria-hidden="true" /></Link>
        </section>
      </div>
    </>
  );
}
