import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BarChart3, CalendarClock, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, fmt, fmtDay, fmtTime, label, rpc, usePeople } from '../lib/ui';
import { initials } from '../components/Frame';
import { CountUp, LiquidBg } from '../components/Liquid';
import { DashSkeleton } from '../components/Skeleton';

const OPEN = '(completed,completed_cycle)';
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// deterministic tile colour per name, from the green family
const TILE = ['#1b5e3b', '#2e7d4f', '#4f9d74', '#0f3d26', '#6aa287'];
const tileColor = (s: string) => TILE[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % TILE.length];

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

// The signed-in person's completed tasks over a chosen range, a labelled bar per day / week / month.
function CompletedChart({ orgId, uid, tick }: { orgId: string; uid: string; tick: number }) {
  const [range, setRange] = useState<Range>('this_week');
  const [cFrom, setCFrom] = useState(''), [cTo, setCTo] = useState('');
  const [dates, setDates] = useState<number[] | null>(null);
  const [from, to] = bounds(range, cFrom, cTo);
  const key = `${from.getTime()}-${to.getTime()}`;
  useEffect(() => {
    let live = true;
    setDates(null);
    supabase.from('tt_tasks').select('completed_at, tt_task_assignees!inner(user_id)').eq('org_id', orgId).eq('tt_task_assignees.user_id', uid)
      .is('archived_at', null).in('status', ['completed', 'completed_cycle']).gte('completed_at', from.toISOString()).lt('completed_at', to.toISOString()).limit(10000)
      .then(({ data }) => { if (live) setDates((data ?? []).map((r: any) => Date.parse(r.completed_at))); });
    return () => { live = false; };
  }, [orgId, uid, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const bs = buckets(from, to), now = Date.now();
  const counts = bs.map((b) => (dates ?? []).filter((t) => t >= b.start.getTime() && t < b.end.getTime()).length);
  const max = Math.max(1, ...counts), best = counts.indexOf(Math.max(...counts)), total = counts.reduce((a, b) => a + b, 0);
  const title = range === 'custom' ? `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${addD(to, -1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : RANGES.find(([r]) => r === range)![1];

  return (<>
    <div className="cc-head">
      <div><h3 id="an-h">My completed tasks</h3><small className="muted">{dates === null ? 'Loading…' : `${total} in ${title.toLowerCase()}`}</small></div>
      <Link to="/reports" className="mini-link"><BarChart3 size={15} aria-hidden="true" />Reports</Link>
    </div>
    <div className="cc-ranges" role="group" aria-label="Date range">
      {RANGES.map(([r, l]) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{l}</button>)}
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
  const manager = can(membership!.role, 'task:write');
  const { name } = usePeople(orgId);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  // live: reload when any task in this org changes (Supabase Realtime, migration 0016), when the tab comes back, and every 2 minutes
  const timer = useRef(0);
  useEffect(() => {
    const soon = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setTick((n) => n + 1), 600); };
    const ch = supabase.channel(`dash-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tt_tasks', filter: `org_id=eq.${orgId}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tt_task_assignees' }, soon)
      .subscribe();
    const vis = () => { if (document.visibilityState === 'visible') soon(); };
    document.addEventListener('visibilitychange', vis);
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') soon(); }, 120_000);
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', vis); clearInterval(iv); clearTimeout(timer.current); };
  }, [orgId]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      // the week chart and the progress gauge count only the signed-in person's own tasks (what My Tasks shows)
      const myTasks = (cols: string) => supabase.from('tt_tasks').select(`${cols}, tt_task_assignees!inner(user_id)`).eq('org_id', orgId)
        .eq('tt_task_assignees.user_id', uid).is('archived_at', null);
      try {
        const [sum, myAll, next, projects, current, mine, esc, escCrit, escLate] = await Promise.all([
          rpc('tt_org_summary', { p_org: orgId, p_day_start: start.toISOString(), p_day_end: end.toISOString() }),
          myTasks('status, due_date').limit(5000),
          myTasks('id, title, status, due_date').not('status', 'in', OPEN).gte('due_date', now.toISOString()).order('due_date').limit(1),
          supabase.from('tt_projects').select('id, name, due_date, status').eq('org_id', orgId).in('status', ['planning', 'not_started', 'in_progress', 'in_review'])
            .order('due_date', { nullsFirst: false }).limit(5),
          supabase.from('tt_tasks').select('id, title, status, tt_task_assignees(user_id)').eq('org_id', orgId).is('archived_at', null)
            .in('status', ['started', 'pending', 'not_yet_started']).order('updated_at', { ascending: false }).limit(100),
          supabase.from('tt_tasks').select('id, title, status, due_date, tt_task_assignees!inner(user_id)').eq('org_id', orgId).eq('tt_task_assignees.user_id', uid)
            .is('archived_at', null).not('status', 'in', OPEN).order('due_date', { nullsFirst: false }).limit(4),
          supabase.from('tt_escalations').select('id', { count: 'exact', head: true }).eq('org_id', orgId).not('state', 'in', '(resolved,closed)'),
          supabase.from('tt_escalations').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('severity', 'critical').not('state', 'in', '(resolved,closed)'),
          supabase.from('tt_escalations').select('id', { count: 'exact', head: true }).eq('org_id', orgId).lt('target_date', now.toISOString()).not('state', 'in', '(resolved,closed)'),
        ]);
        // every number on this page is the signed-in person's own tasks
        const own = { done: 0, active: 0, pending: 0, open: 0, overdue: 0, dueToday: 0, waiting: 0 };
        for (const r of (myAll.data ?? []) as any[]) {
          if (r.status === 'completed' || r.status === 'completed_cycle') { own.done++; continue; }
          own.open++;
          if (r.status === 'started') own.active++; else own.pending++;
          if (r.status === 'pending') own.waiting++;
          if (r.due_date) { const due = Date.parse(r.due_date); if (due < now.getTime()) own.overdue++; if (due >= start.getTime() && due < end.getTime()) own.dueToday++; }
        }
        // one "currently working on" task per person, most recently updated first
        const working = new Map<string, any>();
        for (const t of current.data ?? []) for (const a of t.tt_task_assignees) if (!working.has(a.user_id)) working.set(a.user_id, t);
        setD({
          sum, next: next.data?.[0], projects: projects.data ?? [], mine: mine.data ?? [],
          team: (sum.workload as any[]).filter((w) => w.open).slice(0, 4).map((w) => ({ ...w, task: working.get(w.user_id) })),
          ...own,
          esc: esc.count ?? 0, escCrit: escCrit.count ?? 0, escLate: escLate.count ?? 0,
        });
      } catch (x) { setError((x as Error).message); }
    })();
  }, [orgId, uid, tick]);

  if (error) return <div className="card"><p role="alert">{error}</p></div>;
  if (!d) return <DashSkeleton />;

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-sub">What needs your attention today.</p>
        </div>
        <div className="page-actions">
          {manager && <Link to="/tasks?new=1" className="pill-btn"><Plus size={16} aria-hidden="true" />Add task</Link>}
          {can(membership!.role, 'report:read') && <Link to="/reports" className="pill-btn ghost">View reports</Link>}
        </div>
      </div>

      <div className="dash">
        <div className="a-k1"><Kpi feature title="My open tasks" value={d.open} note={`${d.active} started`} to="/my-tasks" /></div>
        <div className="a-k2"><Kpi title="Overdue" value={d.overdue} note={d.overdue ? 'Past their due date' : 'Everything is on time'} to="/my-tasks?view=overdue" /></div>
        <div className="a-k3"><Kpi title="Due today" value={d.dueToday} note="Before midnight" to="/my-tasks?view=due_today" /></div>
        <div className="a-k4"><Kpi title="Pending" value={d.waiting} note="Waiting on something" to="/my-tasks?view=pending" /></div>

        <section className="card a-an" aria-labelledby="an-h">
          <CompletedChart orgId={orgId} uid={uid} tick={tick} />
        </section>

        <section className="card a-re" aria-labelledby="re-h">
          <h3 id="re-h">Next deadline</h3>
          {d.next ? (<>
            <p className="remind-title">{d.next.title}</p>
            <p className="remind-time">Due {fmtTime(d.next.due_date)}</p>
            <Link to={`/tasks/${d.next.id}`} className="pill-btn wide"><CalendarClock size={16} aria-hidden="true" />Open task</Link>
          </>) : <p className="muted">No upcoming deadlines.</p>}
        </section>

        <section className="card a-pr" aria-labelledby="pr-h">
          <div className="panel-head"><h3 id="pr-h">Projects</h3>{manager && <Link to="/projects" className="pill-btn ghost sm"><Plus size={14} aria-hidden="true" />New</Link>}</div>
          {d.projects.length === 0 ? <p className="muted">No active projects.</p> : (
            <ul className="plist">{d.projects.map((p: any) => (
              <li key={p.id}><span className="tile-ico" style={{ background: tileColor(p.name) }} aria-hidden="true">{initials(p.name).charAt(0)}</span>
                <span><Link to={`/projects/${p.id}`}>{p.name}</Link><small>{p.due_date ? `Due ${fmtDay(p.due_date)}` : label(p.status)}</small></span></li>))}
            </ul>)}
        </section>

        <section className="card a-tm" aria-labelledby="tm-h">
          {manager ? (<>
            <div className="panel-head"><h3 id="tm-h">Team at work</h3>{can(membership!.role, 'members:manage') && <Link to="/employees" className="pill-btn ghost sm"><Plus size={14} aria-hidden="true" />Add member</Link>}</div>
            {d.team.length === 0 ? <p className="muted">Nobody has open work assigned.</p> : (
              <ul className="team">{d.team.map((w: any) => (
                <li key={w.user_id}><span className="avatar" aria-hidden="true">{initials(name(w.user_id))}</span>
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
          <h3 id="pg-h">My task progress</h3>
          <Gauge done={d.done} active={d.active} pending={d.pending} />
        </section>

        <section className="card esc-card a-es" aria-labelledby="es-h">
          <LiquidBg tone="deep" />
          <h3 id="es-h">Escalations</h3>
          <b className="esc-num"><CountUp value={d.esc} /></b>
          <p>{d.escCrit} critical · {d.escLate} past target</p>
          <Link to="/escalations" className="round-btn" aria-label="Open escalations"><ArrowUpRight size={20} aria-hidden="true" /></Link>
        </section>
      </div>
    </>
  );
}
