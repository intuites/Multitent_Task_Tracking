import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BarChart3, CalendarClock, CalendarRange, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, fetchAll, fmt, fmtTime, rpc, usePeople } from '../lib/ui';
import { Avatar } from '../components/Frame';
import { DashSkeleton } from '../components/Skeleton';
import { useLive } from '../lib/live';
import { countTasks, periodBounds, PERIODS, type Period } from '../lib/dashPeriod';
import { Count } from '../stageshow/kit/motion';
import { Chart, chartPoints } from '../stageshow/kit/chart';
import './dashboard.css';

const OPEN = '(completed,completed_cycle)';
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Range = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';
const RANGES: [Range, string][] = [['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['custom', 'Custom']];
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addD = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

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

/** Buckets: one per day up to 2 weeks, per week up to ~4 months, otherwise per month. */
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

/** Scroll effect: which cards have come into view (once each). Their figures count up from 0 and their bars and lines draw in
 *  the first time they're seen; after that they follow live updates. */
function useSeen() {
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const io = useRef<IntersectionObserver | null>(null);
  // one stable ref callback per card, so React attaches each once instead of on every render
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  useEffect(() => () => io.current?.disconnect(), []);
  const reg = useCallback((key: string) => {
    let cb = refs.current.get(key);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (!el) return;
        io.current ??= new IntersectionObserver((es) => es.forEach((e) => {
          if (!e.isIntersecting) return;
          io.current!.unobserve(e.target);
          const k = (e.target as HTMLElement).dataset.seen!;
          setSeen((v) => (v.has(k) ? v : new Set(v).add(k)));
        }), { threshold: 0.2 });
        el.dataset.seen = key;
        io.current.observe(el);
      };
      refs.current.set(key, cb);
    }
    return cb;
  }, []);
  return [seen, reg] as const;
}

/** Width of an element, kept current as the layout changes (the kit's Chart draws at a fixed size). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// Completed tasks over a chosen range, as a line you can scrub: the signed-in person's, or (uid null) the whole organization's.
function CompletedChart({ orgId, uid, tick, reports, period, seen }: { orgId: string; uid: string | null; tick: number; reports: boolean; period: Period; seen: boolean }) {
  const [range, setRange] = useState<Range>('this_week');
  const [cFrom, setCFrom] = useState(''), [cTo, setCTo] = useState('');
  // the dashboard filter moves the chart to the same period (all time: the last 12 months, one point per month); its own menu still works
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
    const q = supabase.from('tt_tasks').select(uid ? 'completed_at, tt_task_assignees!inner(user_id)' : 'completed_at').eq('org_id', orgId);
    (uid ? q.eq('tt_task_assignees.user_id', uid) : q).is('archived_at', null).in('status', ['completed', 'completed_cycle']).gte('completed_at', from.toISOString()).lt('completed_at', to.toISOString()).limit(10000)
      .then(({ data }) => { if (live) setDates((data ?? []).map((r: any) => Date.parse(r.completed_at))); });
    return () => { live = false; };
  }, [orgId, uid, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const bs = buckets(from, to), now = Date.now();
  // future buckets are left off the line, so it ends today instead of dropping to zero
  const past = bs.filter((b) => b.start.getTime() <= now);
  const counts = past.map((b) => (dates ?? []).filter((t) => t >= b.start.getTime() && t < b.end.getTime()).length);
  const total = counts.reduce((a, b) => a + b, 0), best = Math.max(0, ...counts);
  const title = range === 'custom' ? `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${addD(to, -1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : RANGES.find(([r]) => r === range)![1];
  const [box, w] = useWidth<HTMLDivElement>();
  const H = 200, top = Math.max(4, Math.ceil(best * 1.25));
  const data = counts.length > 1 ? counts : [counts[0] ?? 0, counts[0] ?? 0];
  // the line covers only the days so far, on the same spacing as the full range, so each point sits over its label
  const PAD = 4, step = bs.length > 1 ? (w - PAD * 2) / (bs.length - 1) : 0;
  const cw = Math.min(w, PAD * 2 + (data.length - 1) * step || w);
  const xOf = (i: number) => PAD + i * step;
  const pts = w ? chartPoints({ data, width: cw, height: H, max: top }) : [];
  const [hover, setHover] = useState<number | null>(null);
  const at = hover ?? counts.length - 1;
  const scrub = (e: React.PointerEvent) => {
    if (!pts.length) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let i = 0;
    pts.forEach((p, j) => { if (Math.abs(p.x - x) < Math.abs(pts[i].x - x)) i = j; });
    setHover(Math.min(i, counts.length - 1));
  };

  return (<>
    <div className="dx-head">
      <div>
        <h3 id="an-h">{uid ? 'My completed tasks' : 'Completed by the team'}</h3>
        <p className="dx-big"><Count value={dates === null || !seen ? 0 : hover === null ? total : counts[at] ?? 0} /><span>{hover === null ? `in ${range === 'custom' ? title : title.toLowerCase()}` : past[at]?.title}</span></p>
      </div>
      <span className="dx-tools">
        <label className="dash-period cc-period">
          <CalendarRange size={15} aria-hidden="true" />
          <span className="sr-only">Date range</span>
          <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {RANGES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
          </select>
        </label>
        {/* employees can't open Reports; the link would only bounce them back here */}
        {reports && <Link to="/reports" className="mini-link"><BarChart3 size={15} aria-hidden="true" />Reports</Link>}
      </span>
    </div>
    {range === 'custom' && (
      <div className="cc-custom">
        <label>From<input type="date" value={cFrom || isoDay(from)} max={isoDay(new Date())} onChange={(e) => setCFrom(e.target.value)} /></label>
        <label>To<input type="date" value={cTo || isoDay(addD(to, -1))} onChange={(e) => setCTo(e.target.value)} /></label>
      </div>)}
    <div className="dx-plot" ref={box} onPointerMove={scrub} onPointerLeave={() => setHover(null)}
      role="img" aria-label={`Tasks completed, ${title}: ${past.map((b, i) => `${b.title} ${counts[i]}`).join(', ')}`}>
      <span className="dx-grid" aria-hidden="true"><i /><i /><i /><i /></span>
      {w > 0 && <Chart key={`${bs.length}-${data.length}`} data={data} width={cw} height={H} max={top} show={dates !== null && seen} />}
      {hover !== null && pts[at] && (
        <span className="dx-scrub" aria-hidden="true" style={{ left: pts[at].x }}>
          <i style={{ top: pts[at].y }} />
        </span>
      )}
    </div>
    <div className="dx-axis" aria-hidden="true" data-dense={bs.length > 14 || undefined}>
      {bs.map((b, i) => <span key={b.start.getTime()} style={{ left: xOf(i) }} data-on={i === at || undefined} data-future={b.start.getTime() > now || undefined}>{b.label}</span>)}
    </div>
  </>);
}

const STATUS_PARTS = [['not_yet_started', 'Not yet started'], ['started', 'Started'], ['pending', 'Pending']] as const;
const PRIORITIES = [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as const;

/** Time left until a date, kept current every minute. */
function useCountdown(iso?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = window.setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(iv); }, []);
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `in ${d}d ${h}h` : h ? `in ${h}h ${m % 60}m` : `in ${m} min`;
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
          fetchAll(() => myTasks('id, status, priority, due_date, completed_at').order('id')).then((data) => ({ data })),
          myTasks('id, title, status, due_date').not('status', 'in', OPEN).gte('due_date', now.toISOString()).order('due_date').limit(1),
          supabase.from('tt_tasks').select('id, title, status, tt_task_assignees(user_id)').eq('org_id', orgId).is('archived_at', null)
            .in('status', ['started', 'pending', 'not_yet_started']).order('updated_at', { ascending: false }).limit(100),
          supabase.from('tt_tasks').select('id, title, status, due_date, tt_task_assignees!inner(user_id)').eq('org_id', orgId).eq('tt_task_assignees.user_id', uid)
            .is('archived_at', null).not('status', 'in', OPEN).order('due_date', { nullsFirst: false }).limit(5),
        ]);
        // one "currently working on" task per person, most recently updated first
        const working = new Map<string, any>();
        for (const t of current.data ?? []) for (const a of t.tt_task_assignees) if (!working.has(a.user_id)) working.set(a.user_id, t);
        setD({
          sum, next: next.data?.[0], mine: mine.data ?? [],
          team: (sum.workload as any[]).filter((w) => w.open).sort((a, b) => b.open - a.open).slice(0, 5).map((w) => ({ ...w, task: working.get(w.user_id) })),
          // every number is the signed-in person's own tasks (a platform admin's: the organization's), counted for the period below
          rows: myAll.data ?? [],
        });
      } catch (x) { setError((x as Error).message); }
    })();
  }, [orgId, uid, tick, all]);

  // recounted when the filter changes, without reloading; the clock tick keeps "overdue" and "due today" current
  const c = useMemo(() => countTasks(d?.rows ?? [], period), [d, period, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // open work in the period, split by status and by priority (the same tasks the Open card counts)
  const split = useMemo(() => {
    const b = periodBounds(period), s: Record<string, number> = {}, p: Record<string, number> = {};
    for (const r of (d?.rows ?? []) as any[]) {
      if (r.status === 'completed' || r.status === 'completed_cycle') continue;
      if (b && !(r.due_date && Date.parse(r.due_date) >= b[0] && Date.parse(r.due_date) < b[1])) continue;
      s[r.status] = (s[r.status] ?? 0) + 1;
      p[r.priority ?? 'medium'] = (p[r.priority ?? 'medium'] ?? 0) + 1;
    }
    return { s, p };
  }, [d, period]);
  const left = useCountdown(d?.next?.due_date);
  const [seen, reg] = useSeen();
  if (error) return <div className="card"><p role="alert">{error}</p></div>;
  if (!d) return <DashSkeleton />;
  const span = period === 'week' ? 'this week' : period === 'month' ? 'this month' : '';
  const maxP = Math.max(1, ...PRIORITIES.map(([k]) => split.p[k] ?? 0));
  const rate = pct(c.done, c.done + c.open);
  const stats: [string, number, string, number, string][] = [
    [all ? 'Open tasks' : 'My open tasks', c.open, span ? `Due ${span} · ${c.active} started` : `${c.active} started`, pct(c.active, c.open), tasks],
    ['Overdue', c.overdue, c.overdue ? `${pct(c.overdue, c.open)}% of open work` : 'Everything is on time', pct(c.overdue, c.open), `${tasks}?view=overdue`],
    ['Due today', c.dueToday, 'Before midnight', pct(c.dueToday, c.open), `${tasks}?view=due_today`],
    ['Pending', c.waiting, 'Waiting on something', pct(c.waiting, c.open), `${tasks}?view=pending`],
  ];

  return (
    <div className="dx">
      <div className="page-head">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-sub">
            {all ? `How ${membership!.org_name} is doing today, across every task.` : 'What needs your attention today.'}
          </p>
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

      <div className="dx-grid-main">
        {stats.map(([title, v, note, share, to], i) => (
          <Link key={title} ref={reg(`s${i}`)} to={to} className="dx-card dx-stat" data-lead={i === 0 || undefined} data-alert={(i === 1 && v > 0) || undefined} style={{ '--n': i } as React.CSSProperties}>
            <span className="dx-stat-head">{title}<ArrowUpRight size={16} aria-hidden="true" /></span>
            <b className="dx-fig"><Count value={seen.has(`s${i}`) ? v : 0} /></b>
            <span className="dx-meter" aria-hidden="true"><i style={{ width: `${seen.has(`s${i}`) ? share : 0}%` }} /></span>
            <small>{note}</small>
          </Link>
        ))}

        <section ref={reg('chart')} className="dx-card dx-chart" aria-labelledby="an-h" style={{ '--n': 4 } as React.CSSProperties}>
          <CompletedChart orgId={orgId} uid={all ? null : uid} tick={tick} reports={can(membership!.role, 'report:read')} period={period} seen={seen.has('chart')} />
        </section>

        <section ref={reg('split')} className="dx-card dx-split" aria-labelledby="sp-h" style={{ '--n': 5 } as React.CSSProperties}>
          <h3 id="sp-h">Open work</h3>
          <p className="dx-big"><Count value={seen.has('split') ? c.open : 0} /><span>{span ? `due ${span}` : 'tasks'}</span></p>
          <span className="dx-stack" role="img" aria-label={STATUS_PARTS.map(([k, l]) => `${l} ${split.s[k] ?? 0}`).join(', ')}>
            {STATUS_PARTS.map(([k]) => <i key={k} data-k={k} style={{ flexGrow: seen.has('split') ? split.s[k] ?? 0 : 0 }} />)}
          </span>
          <ul className="dx-legend">
            {STATUS_PARTS.map(([k, l]) => <li key={k}><i data-k={k} />{l}<b><Count value={seen.has('split') ? split.s[k] ?? 0 : 0} /></b></li>)}
          </ul>
          <h4>By priority</h4>
          <ul className="dx-rank">
            {PRIORITIES.map(([k, l]) => (
              <li key={k}><span>{l}</span><span className="dx-bar" aria-hidden="true"><i data-k={k} style={{ width: `${seen.has('split') ? ((split.p[k] ?? 0) / maxP) * 100 : 0}%` }} /></span><b><Count value={seen.has('split') ? split.p[k] ?? 0 : 0} /></b></li>
            ))}
          </ul>
        </section>

        <section className="dx-card dx-next" aria-labelledby="re-h" style={{ '--n': 6 } as React.CSSProperties}>
          <h3 id="re-h">Next deadline</h3>
          {d.next ? (<>
            <p className="dx-count">{left}</p>
            <p className="remind-title">{d.next.title}</p>
            <p className="remind-time">Due {fmtTime(d.next.due_date)}</p>
            <Link to={`/tasks/${d.next.id}`} className="pill-btn wide"><CalendarClock size={16} aria-hidden="true" />Open task</Link>
          </>) : <p className="muted">No upcoming deadlines.</p>}
        </section>

        <section className="dx-card dx-team" aria-labelledby="tm-h" style={{ '--n': 7 } as React.CSSProperties}>
          {canAssign ? (<>
            <div className="panel-head"><h3 id="tm-h">Team at work</h3>{can(membership!.role, 'members:manage') && <Link to="/employees" className="pill-btn ghost sm"><Plus size={14} aria-hidden="true" />Add member</Link>}</div>
            {d.team.length === 0 ? <p className="muted">Nobody has open work assigned.</p> : (
              <ul className="dx-people">{d.team.map((w: any) => (
                <li key={w.user_id}><Avatar name={name(w.user_id)} url={photo(w.user_id)} />
                  <span className="who"><b>{name(w.user_id)}</b><small>{w.task ? <>Working on <Link to={`/tasks/${w.task.id}`}>{w.task.title}</Link></> : `${w.open} open tasks`}</small></span>
                  <span className="dx-load" title={`${w.open} open, ${w.overdue} overdue`}><b>{w.open}</b><small>open</small></span></li>))}
              </ul>)}
          </>) : (<>
            <div className="panel-head"><h3 id="tm-h">My tasks</h3><Link to="/my-tasks" className="mini-link">View all</Link></div>
            {d.mine.length === 0 ? <p className="muted">Nothing assigned to you.</p> : (
              <ul className="dx-people">{d.mine.map((t: any) => (
                <li key={t.id}><span className="who"><Link to={`/tasks/${t.id}`}><b>{t.title}</b></Link><small>Due {fmt(t.due_date)}</small></span><Badge v={t.status} /></li>))}
              </ul>)}
          </>)}
        </section>

        <section ref={reg('done')} className="dx-card dx-done" aria-labelledby="es-h" style={{ '--n': 8 } as React.CSSProperties}>
          <div className="panel-head"><h3 id="es-h">Completed</h3><Link to={`${tasks}?view=completed`} className="mini-link" aria-label={all ? 'Open completed tasks' : 'Open my completed tasks'}>View<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
          <div className="dx-ring" role="img" aria-label={`${rate}% of tasks done`} style={{ '--p': seen.has('done') ? rate : 0 } as React.CSSProperties}>
            <b><Count value={seen.has('done') ? rate : 0} />%</b><small>done</small>
          </div>
          <p className="dx-done-line"><b><Count value={seen.has('done') ? c.done : 0} /></b> {span ? `finished ${span}` : 'finished'} · {c.cycle} this cycle · {c.done - c.cycle} permanently</p>
        </section>
      </div>
    </div>
  );
}
