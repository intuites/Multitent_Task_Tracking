import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarClock, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, fmt, fmtTime, rpc, usePeople } from '../lib/ui';
import { initials } from '../components/Frame';
import { CountUp } from '../components/Liquid';
import { DashSkeleton } from '../components/Skeleton';

const OPEN = '(completed,completed_cycle)';
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Stat({ title, value, note, to, alert }: { title: string; value: number; note: string; to: string; alert?: boolean }) {
  return (
    <Link to={to} className={alert ? 'db-stat alert' : 'db-stat'}>
      <span className="db-stat-title">{title}</span>
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
    <div key={key} className={`db-bars ${bs.length > 10 ? 'dense' : ''}`} style={{ gridTemplateColumns: `repeat(${bs.length}, 1fr)` }}
      role="img" aria-label={`Tasks completed, ${title}: ${bs.map((b, i) => `${b.title} ${counts[i]}`).join(', ')}`}>
      {bs.map((b, i) => {
        const c = counts[i], future = b.start.getTime() > now, current = b.start.getTime() <= now && now < b.end.getTime();
        return (
          <div key={b.start.getTime()} className={`db-col${current ? ' now' : ''}${future ? ' future' : ''}${i === best && c ? ' best' : ''}`}
            style={{ '--i': i } as React.CSSProperties} title={`${b.title}: ${future ? 'not yet' : `${c} completed`}`}>
            <div className="db-track">
              {!future && dates !== null && <span className="db-val">{c}</span>}
              {!future && c > 0 && <span className="db-bar" style={{ height: `${Math.max(6, (c / max) * 100)}%` }} />}
            </div>
            <span className="db-day">{b.label}</span>
          </div>
        );
      })}
    </div>
  </>);
}

// Share of the person's tasks done, started and not started, as one stacked line.
function Progress({ done, cycle, active, pending }: { done: number; cycle: number; active: number; pending: number }) {
  const total = done + active + pending;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="db-progress">
      <p className="db-pct"><b>{total ? `${pct}%` : 'No tasks yet'}</b>{total > 0 && <small>{done} of {total} tasks done</small>}</p>
      <div className="db-stack" role="img" aria-label={`${pct}% of tasks completed: ${done} completed, ${active} started, ${pending} not started or pending`}>
        <i className="done" style={{ width: w(done) }} /><i className="active" style={{ width: w(active) }} />
      </div>
      <ul className="db-legend">
        <li><i className="sw done" />Completed <b>{done}</b></li><li><i className="sw active" />Started <b>{active}</b></li><li><i className="sw open" />Not started <b>{pending}</b></li>
      </ul>
      <Link to="/my-tasks?view=completed" className="mini-link db-more">{cycle} completed this cycle, {done - cycle} for good<ArrowRight size={14} aria-hidden="true" /></Link>
    </div>
  );
}

export default function Dashboard() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id;
  const canAssign = can(membership!.role, 'task:write');
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
        const [sum, myAll, next, current, mine] = await Promise.all([
          rpc('tt_org_summary', { p_org: orgId, p_day_start: start.toISOString(), p_day_end: end.toISOString() }),
          myTasks('status, due_date').limit(5000),
          myTasks('id, title, status, due_date').not('status', 'in', OPEN).gte('due_date', now.toISOString()).order('due_date').limit(1),
          supabase.from('tt_tasks').select('id, title, status, tt_task_assignees(user_id)').eq('org_id', orgId).is('archived_at', null)
            .in('status', ['started', 'pending', 'not_yet_started']).order('updated_at', { ascending: false }).limit(100),
          supabase.from('tt_tasks').select('id, title, status, due_date, tt_task_assignees!inner(user_id)').eq('org_id', orgId).eq('tt_task_assignees.user_id', uid)
            .is('archived_at', null).not('status', 'in', OPEN).order('due_date', { nullsFirst: false }).limit(4),
        ]);
        // every number on this page is the signed-in person's own tasks
        const own = { done: 0, cycle: 0, active: 0, pending: 0, open: 0, overdue: 0, dueToday: 0, waiting: 0 };
        for (const r of (myAll.data ?? []) as any[]) {
          if (r.status === 'completed' || r.status === 'completed_cycle') { own.done++; if (r.status === 'completed_cycle') own.cycle++; continue; }
          own.open++;
          if (r.status === 'started') own.active++; else own.pending++;
          if (r.status === 'pending') own.waiting++;
          if (r.due_date) { const due = Date.parse(r.due_date); if (due < now.getTime()) own.overdue++; if (due >= start.getTime() && due < end.getTime()) own.dueToday++; }
        }
        // one "currently working on" task per person, most recently updated first
        const working = new Map<string, any>();
        for (const t of current.data ?? []) for (const a of t.tt_task_assignees) if (!working.has(a.user_id)) working.set(a.user_id, t);
        setD({
          sum, next: next.data?.[0], mine: mine.data ?? [],
          team: (sum.workload as any[]).filter((w) => w.open).slice(0, 4).map((w) => ({ ...w, task: working.get(w.user_id) })),
          ...own,
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
          {canAssign && <Link to="/tasks?new=1" className="pill-btn"><Plus size={16} aria-hidden="true" />Add task</Link>}
          {can(membership!.role, 'report:read') && <Link to="/reports" className="pill-btn ghost">View reports</Link>}
        </div>
      </div>

      <div className="db">
        <section className="card db-stats" aria-label="My tasks at a glance">
          <Stat title="Open" value={d.open} note={`${d.active} started`} to="/my-tasks" />
          <Stat title="Overdue" value={d.overdue} note={d.overdue ? 'Past their due date' : 'Everything is on time'} to="/my-tasks?view=overdue" alert={d.overdue > 0} />
          <Stat title="Due today" value={d.dueToday} note="Before midnight" to="/my-tasks?view=due_today" />
          <Stat title="Pending" value={d.waiting} note="Waiting on something" to="/my-tasks?view=pending" />
        </section>

        <section className="card db-chart" aria-labelledby="an-h">
          <CompletedChart orgId={orgId} uid={uid} tick={tick} />
        </section>

        <div className="db-aside">
          <section className="card db-next" aria-labelledby="re-h">
            <h3 id="re-h">Next deadline</h3>
            {d.next ? (<>
              <Link to={`/tasks/${d.next.id}`} className="db-next-title">{d.next.title}</Link>
              <p className="db-next-time"><CalendarClock size={15} aria-hidden="true" />Due {fmtTime(d.next.due_date)}</p>
            </>) : <p className="muted">No upcoming deadlines.</p>}
          </section>

          <section className="card" aria-labelledby="pg-h">
            <h3 id="pg-h">My progress</h3>
            <Progress done={d.done} cycle={d.cycle} active={d.active} pending={d.pending} />
          </section>
        </div>

        <section className="card db-people" aria-labelledby="tm-h">
          {canAssign ? (<>
            <div className="panel-head"><h3 id="tm-h">Team at work</h3>{can(membership!.role, 'members:manage') && <Link to="/employees" className="pill-btn ghost sm"><Plus size={14} aria-hidden="true" />Add member</Link>}</div>
            {d.team.length === 0 ? <p className="muted">Nobody has open work assigned.</p> : (
              <ul className="db-rows">{d.team.map((w: any) => (
                <li key={w.user_id}><span className="avatar" aria-hidden="true">{initials(name(w.user_id))}</span>
                  <span className="who"><b>{name(w.user_id)}</b><small>{w.task ? <>Working on <Link to={`/tasks/${w.task.id}`}>{w.task.title}</Link></> : `${w.open} open tasks`}</small></span>
                  {w.task && <Badge v={w.task.status} />}</li>))}
              </ul>)}
          </>) : (<>
            <div className="panel-head"><h3 id="tm-h">My tasks</h3><Link to="/my-tasks" className="mini-link">View all</Link></div>
            {d.mine.length === 0 ? <p className="muted">Nothing assigned to you.</p> : (
              <ul className="db-rows">{d.mine.map((t: any) => (
                <li key={t.id}><span className="who"><Link to={`/tasks/${t.id}`}><b>{t.title}</b></Link><small>Due {fmt(t.due_date)}</small></span><Badge v={t.status} /></li>))}
              </ul>)}
          </>)}
        </section>
      </div>
    </>
  );
}
