import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarRange, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, fetchAll, NO_ESC, usePeople } from '../lib/ui';
import { Avatar } from '../components/Frame';
import { CountUp, LiquidBg } from '../components/Liquid';
import { DashSkeleton } from '../components/Skeleton';
import { useLive } from '../lib/live';
import { countTasks, PERIODS, type Period } from '../lib/dashPeriod';
import { dueWeek, headline, months12, smooth, sparks, throughput, type TRow } from '../lib/dashStats';
import { describe, type LogRow } from '../lib/activityText';

const ago = (t: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  const d = Math.round(s / 86400); return `${d} day${d === 1 ? '' : 's'} ago`;
};
const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** A small trend line under a number (the stroke keeps its width however the card stretches). */
function Spark({ values, area, label: name }: { values: number[]; area?: boolean; label: string }) {
  const max = Math.max(1, ...values), min = Math.min(...values), span = Math.max(1, max - min);
  const pts = values.map((v, i): [number, number] => [(i / (values.length - 1)) * 200, 40 - ((v - min) / span) * 34]);
  const line = smooth(pts);
  return (
    <svg className="dz-spark" viewBox="0 0 200 46" preserveAspectRatio="none" role="img" aria-label={`${name}: ${values[0]} to ${values[values.length - 1]} over the period`}>
      {area && <path d={`${line} L200 46 L0 46 Z`} className="fill" />}
      <path d={line} className="line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ title, value, chip, to, feature, tone, children }: { title: string; value: number; chip?: string; to: string; feature?: boolean; tone?: string; children: React.ReactNode }) {
  return (
    <Link to={to} className={`kpi dz-kpi${feature ? ' feature' : ''}${tone ? ` ${tone}` : ''}`}>
      {feature && <LiquidBg />}
      <span className="kpi-head"><span>{title}</span><span className="go" aria-hidden="true"><ArrowUpRight size={16} /></span></span>
      <span className="dz-val"><b><CountUp value={value} /></b>{chip && <span className="dz-chip">{chip}</span>}</span>
      {children}
    </Link>
  );
}

/** Created vs completed per day / week / month, overdue marks along the bottom; hover (or focus and arrow keys) for each point. */
function Throughput({ data }: { data: ReturnType<typeof throughput> }) {
  const ref = useRef<HTMLDivElement>(null);
  // the chart fills its card: width and height follow the card (the right column sets how tall the card is)
  const [[w, H], setSize] = useState([800, 260]);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize([Math.max(280, Math.round(e.contentRect.width)), Math.max(220, Math.round(e.contentRect.height))])); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const top = 14, base = H - 30;
  const past = data.filter((b) => !b.future), last = Math.max(0, past.length - 1);
  const [hover, setHover] = useState<number | null>(null);
  const at = hover ?? last;
  const max = Math.max(1, ...data.map((b) => Math.max(b.created, b.completed)));
  const x = (i: number) => (data.length === 1 ? w / 2 : 12 + (i / (data.length - 1)) * (w - 24));
  const y = (v: number) => base - (v / max) * (base - top);
  const done = smooth(past.map((b, i): [number, number] => [x(i), y(b.completed)]));
  const made = smooth(past.map((b, i): [number, number] => [x(i), y(b.created)]));
  const omax = Math.max(1, ...data.map((b) => b.overdue));
  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - 12) / (w - 24)) * (data.length - 1));
    setHover(Math.min(last, Math.max(0, i)));
  };
  const b = data[at];
  return (
    <div className="dz-chart" ref={ref} tabIndex={0} role="img"
      aria-label={`Created and completed tasks: ${past.map((p) => `${p.title}, ${p.created} created, ${p.completed} completed`).join('; ')}`}
      onMouseMove={(e) => pick(e.clientX)} onMouseLeave={() => setHover(null)}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') setHover(Math.max(0, at - 1)); if (e.key === 'ArrowRight') setHover(Math.min(last, at + 1)); }}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true">
        <defs>
          <linearGradient id="dz-ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".38" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient>
          <linearGradient id="dz-gv" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--dz-violet)" stopOpacity=".2" /><stop offset="1" stopColor="var(--dz-violet)" stopOpacity="0" /></linearGradient>
          <filter id="dz-glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="0" x2={w} y1={base - f * (base - top)} y2={base - f * (base - top)} className="grid" />)}
        {past.length > 1 && <>
          <path d={`${made} L${x(last)} ${base} L${x(0)} ${base} Z`} fill="url(#dz-gv)" />
          <path d={made} className="made" />
          <path d={`${done} L${x(last)} ${base} L${x(0)} ${base} Z`} fill="url(#dz-ga)" />
          <path d={done} className="done" filter="url(#dz-glow)" />
        </>}
        {data.map((p, i) => p.overdue > 0 && <rect key={i} x={x(i) - 4} y={H - 22 - (p.overdue / omax) * 16} width="8" height={(p.overdue / omax) * 16 + 2} rx="3" className="od" />)}
        <line x1={x(at)} x2={x(at)} y1={top - 6} y2={base} className="cross" />
        <circle cx={x(at)} cy={y(b.completed)} r="6" className="dot" />
        <circle cx={x(at)} cy={y(b.completed)} r="12" className="halo" />
      </svg>
      <div className={`dz-tip${x(at) > w * 0.6 ? ' left' : ''}`} style={{ left: x(at), top: Math.max(0, y(b.completed) - 74) }}>
        <small>{b.title}</small><b>{b.completed} completed</b><small>{b.created} created{b.overdue ? ` · ${b.overdue} overdue` : ''}</small>
      </div>
      <div className="dz-axis">{data.map((p, i) => <span key={i} className={i === at ? 'on' : ''} style={{ left: x(i) }}>{p.label}</span>)}</div>
    </div>
  );
}

function Ring({ parts }: { parts: { name: string; n: number; cls: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0), C = 2 * Math.PI * 46;
  let off = 0;
  return (
    <svg viewBox="0 0 120 120" className="dz-ring" role="img" aria-label={parts.map((p) => `${p.name} ${p.n}`).join(', ')}>
      <circle cx="60" cy="60" r="46" className="track" />
      {total > 0 && parts.map((p) => {
        const len = (p.n / total) * C, el = p.n ? <circle key={p.name} cx="60" cy="60" r="46" className={p.cls} strokeDasharray={`${Math.max(0, len - 3)} ${C}`} strokeDashoffset={-off} /> : null;
        off += len; return el;
      })}
      <text x="60" y="58" textAnchor="middle" className="n">{total}</text>
      <text x="60" y="76" textAnchor="middle" className="t">tasks</text>
    </svg>
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
  const [d, setD] = useState<{ rows: TRow[]; logs: LogRow[]; titles: Record<string, string>; at: number } | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [, setNow] = useState(0); // re-renders "updated 2 min ago"
  // remembered per browser
  const [period, setPeriodState] = useState<Period>(() => { try { const v = localStorage.getItem('tt-dash-period'); return v === 'week' || v === 'month' ? v : 'all'; } catch { return 'all'; } });
  const setPeriod = (p: Period) => { setPeriodState(p); try { localStorage.setItem('tt-dash-period', p); } catch { /* storage blocked */ } };

  // live: reload when tasks change (that is also what writes the activity log), and on the clock every 2 minutes so "overdue" and "due today" stay right
  useLive(['tt_tasks', 'tt_task_assignees'], () => setTick((n) => n + 1));
  useEffect(() => {
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') setTick((n) => n + 1); }, 120_000);
    const clockIv = window.setInterval(() => setNow((n) => n + 1), 20_000);
    return () => { clearInterval(iv); clearInterval(clockIv); };
  }, []);

  useEffect(() => {
    (async () => {
      // the person's own tasks (what My Tasks shows); a platform admin's: every task in the organization
      const myTasks = (cols: string) => {
        const q = supabase.from('tt_tasks').select(all ? cols : `${cols}, tt_task_assignees!inner(user_id)`).eq('org_id', orgId);
        return (all ? q : q.eq('tt_task_assignees.user_id', uid)).is('archived_at', null);
      };
      try {
        const [rows, logs] = await Promise.all([
          fetchAll(() => myTasks('id, status, due_date, completed_at, created_at').order('id')),
          // what the database lets this person read: admins the whole log, others their own and their tasks'
          supabase.from('tt_activity_logs').select('*').eq('org_id', orgId).not('action', 'like', NO_ESC).order('created_at', { ascending: false }).limit(6),
        ]);
        const got = (logs.data ?? []) as LogRow[];
        const ids = [...new Set(got.filter((r) => r.entity_type === 'task').map((r) => r.entity_id))];
        const t = ids.length ? (await supabase.from('tt_tasks').select('id, title').in('id', ids)).data ?? [] : [];
        setD({ rows: rows as TRow[], logs: got, titles: Object.fromEntries(t.map((x: any) => [x.id, x.title])), at: Date.now() });
      } catch (x) { setError((x as Error).message); }
    })();
  }, [orgId, uid, tick, all]);

  // recounted when the filter changes, without reloading; the clock tick keeps "overdue" and "due today" current
  const v = useMemo(() => {
    const rows = d?.rows ?? [];
    return { c: countTasks(rows, period), h: headline(rows, period), s: sparks(rows, period), wk: dueWeek(rows), tp: throughput(rows, period), m: months12(rows) };
  }, [d, period, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="card"><p role="alert">{error}</p></div>;
  if (!d) return <DashSkeleton />;

  const { c, h, s, wk, tp, m } = v;
  const span = period === 'week' ? 'this week' : period === 'month' ? 'this month' : '';
  const notStarted = c.pending - c.waiting, mixTotal = c.done + c.open;
  const mix = [{ name: 'Completed', n: c.done, cls: 'm-done' }, { name: 'Started', n: c.active, cls: 'm-start' }, { name: 'Pending', n: c.waiting, cls: 'm-pend' }, { name: 'Not started', n: notStarted, cls: 'm-idle' }];
  const mmax = Math.max(1, ...m.map((x) => x.n));
  const person = (id?: string | null) => { const n = name(id ?? ''); return n === 'Former member' ? 'A former member' : n; };

  return (
    <div className="dz">
      <div className="page-head">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-sub">{all ? `How ${membership!.org_name} is doing ${span || 'across every task'}.` : `What needs your attention ${span || 'across all your tasks'}.`}
            <span className="dz-live" aria-live="polite"><i aria-hidden="true" />Live · updated {ago(d.at)}</span></p>
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

      <div className="dz-kpis">
        <Kpi feature title={all ? 'Open tasks' : 'My open tasks'} value={c.open} chip={`${c.active} started`} to={tasks}>
          <Spark values={s.open} label="Open tasks" />
        </Kpi>
        <Kpi title="Overdue" tone={c.overdue ? 'k-bad' : 'k-calm'} value={c.overdue} chip={wk.lateToday ? `+${wk.lateToday} today` : c.overdue ? undefined : 'On time'} to={`${tasks}?view=overdue`}>
          <Spark values={s.overdue} area label="Overdue tasks" />
        </Kpi>
        <Kpi title="Due today" tone="k-violet" value={c.dueToday} chip={wk.nextToday ? `Next ${clock(wk.nextToday)}` : c.dueToday ? 'All past due' : 'Nothing left'} to={`${tasks}?view=due_today`}>
          <span className="dz-week" role="img" aria-label={`Open tasks due each day this week: ${wk.bars.join(', ')}`}>
            {wk.bars.map((n, i) => <i key={i} className={i === wk.today ? 'on' : ''} style={{ height: `${n ? 22 + (n / Math.max(...wk.bars)) * 78 : 10}%` }} title={`${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}: ${n} due`} />)}
          </span>
        </Kpi>
        <Kpi title="Completed" tone="k-teal" value={c.done} chip={span ? `${span}` : `${s.completed[11]} in 12 months`} to={`${tasks}?view=completed`}>
          <Spark values={s.completed} area label="Tasks completed" />
        </Kpi>
      </div>

      <div className="dz-grid">
        <section className="card dz-big" aria-labelledby="tp-h">
          <div className="dz-head">
            <div><h3 id="tp-h">Throughput</h3><small>Tasks created and completed {period === 'all' ? 'per month, last 12 months' : period === 'month' ? 'per week' : 'per day'}</small></div>
            <ul className="dz-legend"><li><i className="l-done" />Completed</li><li><i className="l-made" />Created</li><li><i className="l-od" />Fell overdue</li></ul>
          </div>
          <div className="dz-stats">
            <div><b>{h.rate ?? '—'}{h.rate !== null && '%'}</b><small>Completion rate</small></div>
            <div><b>{h.onTime ?? '—'}{h.onTime !== null && '%'}</b><small>Finished on time</small></div>
            <div><b>{h.avgDays ?? '—'}{h.avgDays !== null && ' d'}</b><small>Avg. time to finish</small></div>
            <div><b className={h.change === null ? '' : h.change >= 0 ? 'up' : 'down'}>{h.change === null ? '—' : `${h.change > 0 ? '+' : ''}${h.change}%`}</b><small>Completed, {h.compare}</small></div>
          </div>
          <Throughput data={tp} />
        </section>

        <section className="card" aria-labelledby="mix-h">
          <div className="dz-head"><div><h3 id="mix-h">Status mix</h3><small>{span ? `Due or finished ${span}` : 'All open and finished work'}</small></div></div>
          <div className="dz-mix">
            <Ring parts={mix} />
            <ul className="dz-bars">{mix.map((p) => (
              <li key={p.name}><span>{p.name}</span><span className="tr"><i className={p.cls} style={{ width: `${mixTotal ? (p.n / mixTotal) * 100 : 0}%` }} /></span><b>{p.n}</b></li>))}
            </ul>
          </div>
          <div className="dz-heat" role="img" aria-label={`Completed per month: ${m.map((x) => `${x.title} ${x.n}`).join(', ')}`}>
            {m.map((x, i) => <i key={i} title={`${x.title}: ${x.n} completed`} style={{ '--o': x.n ? 0.18 + (x.n / mmax) * 0.82 : 0.06 } as React.CSSProperties} className={i === 11 ? 'now' : ''} />)}
          </div>
          <small className="dz-heat-cap">Completed each month, last 12 months</small>
        </section>

        <section className="card" aria-labelledby="act-h">
          <div className="dz-head"><div><h3 id="act-h">Live activity</h3><small>{all || canAssign ? 'What the team is doing' : 'Your tasks, as they change'}</small></div>
            {canAssign && <Link to="/activity" className="mini-link">View all</Link>}</div>
          {d.logs.length === 0 ? <p className="muted dz-empty">Nothing has happened yet. New work shows up here as it happens.</p> : (
            <ul className="dz-feed">{d.logs.map((r) => {
              const sn = describe(r, person, (id) => d.titles[id]);
              const to = r.action === 'status_changed' ? r.detail?.to : r.action === 'created' ? 'new' : null;
              return (
                <li key={r.id}>
                  <Avatar name={person(r.actor_id)} url={photo(r.actor_id ?? '')} className="avatar sm" />
                  <p><b>{person(r.actor_id)}</b> {sn.verb}{sn.target && <> {sn.target.to ? <Link to={sn.target.to}>{sn.target.text}</Link> : sn.target.text}</>}{sn.rest}
                    <small title={new Date(r.created_at).toLocaleString()}>{ago(Date.parse(r.created_at))}</small></p>
                  {to && (to === 'new' ? <span className="dz-tag">New</span> : <Badge v={to} />)}
                </li>);
            })}</ul>)}
        </section>
      </div>
    </div>
  );
}

