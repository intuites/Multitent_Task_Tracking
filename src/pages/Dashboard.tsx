import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BarChart3, CalendarClock, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../../api/_lib/permissions';
import { Badge, fetchAll, fmt, fmtTime, rpc, usePeople } from '../lib/ui';
import { Avatar } from '../components/Frame';
import { CountUp, LiquidBg } from '../components/Liquid';
import { DashSkeleton } from '../components/Skeleton';
import { useLive } from '../lib/live';
import { countTasks, periodBounds, PERIODS, type Period } from '../lib/dashPeriod';

const OPEN = '(completed,completed_cycle)';
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Kpi({ title, value, note, to, feature, tone }: { title: string; value: number; note: string; to: string; feature?: boolean; tone?: 'bad' }) {
  return (
    <Link to={to} className={`kpi${feature ? ' feature' : ''}${tone && value ? ` ${tone}` : ''}`}>
      {feature && <LiquidBg />}
      <span className="kpi-head"><span>{title}</span><span className="go" aria-hidden="true"><ArrowUpRight size={16} /></span></span>
      <b><CountUp value={value} /></b>
      <small>{note}</small>
    </Link>
  );
}

/** Bars for the period: a day each for a week, a week each for a month, a month each for the last 12 months (all time). */
function buckets(p: Period, now = new Date()) {
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const out: { start: number; end: number; label: string; title: string }[] = [];
  const b = periodBounds(p, now);
  if (p === 'week') for (let i = 0; i < 7; i++) {
    const d = new Date(b![0]); d.setDate(d.getDate() + i); const e = new Date(d); e.setDate(e.getDate() + 1);
    out.push({ start: d.getTime(), end: e.getTime(), label: DAYS[d.getDay()], title: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) });
  } else if (p === 'month') for (let d = new Date(b![0]); d.getTime() < b![1]; d.setDate(d.getDate() + 7)) {
    const e = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime(), b![1]);
    out.push({ start: d.getTime(), end: e, label: md(d), title: `${md(d)} – ${md(new Date(e - 864e5))}` });
  } else for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1), e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({ start: d.getTime(), end: e.getTime(), label: d.toLocaleDateString('en-US', { month: 'short' }), title: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

// Completed tasks in the period, one labelled bar per day / week / month (from the rows the page already loaded).
function CompletedBars({ rows, period }: { rows: any[]; period: Period }) {
  const bs = buckets(period), now = Date.now();
  const times = rows.filter((r) => r.completed_at && (r.status === 'completed' || r.status === 'completed_cycle')).map((r) => Date.parse(r.completed_at));
  const counts = bs.map((b) => times.filter((t) => t >= b.start && t < b.end).length);
  const max = Math.max(1, ...counts), best = counts.indexOf(Math.max(...counts));
  return (
    <div key={period} className={`weekbars cc-bars ${bs.length > 10 ? 'dense' : ''}`} style={{ gridTemplateColumns: `repeat(${bs.length}, 1fr)` }}
      role="img" aria-label={`Tasks completed: ${bs.map((b, i) => `${b.title} ${counts[i]}`).join(', ')}`}>
      {bs.map((b, i) => {
        const c = counts[i], future = b.start > now, current = b.start <= now && now < b.end;
        const cls = future ? 'bar future' : c === 0 ? 'bar zero' : current ? 'bar today' : i === best ? 'bar best' : 'bar';
        return (
          <div key={b.start} className="bar-col" style={{ '--i': i } as React.CSSProperties} title={`${b.title}: ${c} completed`}>
            <div className="bar-track">
              <span className="bar-stack" style={{ height: future ? '100%' : c === 0 ? '8%' : `${Math.max(16, (c / max) * 100)}%` }}>
                {!future && <span className={`bar-val ${current ? 'now' : ''}`}>{c}</span>}
                <span className={cls} />
              </span>
            </div>
            <span className={`bar-day ${current ? 'now' : ''}`}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** "3 days late", "Due today, 5:00 PM", "Due tomorrow", "Due Nov 28" */
function dueText(iso: string, now = new Date()) {
  const d = new Date(iso), day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(now)) / 864e5);
  if (d.getTime() < now.getTime()) { const late = Math.max(0, -days); return { late: true, text: late === 0 ? 'Overdue today' : `${late} day${late === 1 ? '' : 's'} late` }; }
  if (days === 0) return { late: false, text: `Due today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` };
  if (days === 1) return { late: false, text: 'Due tomorrow' };
  return { late: false, text: `Due ${fmt(iso)}` };
}

export default function Dashboard() {
  const { membership, session } = useAuth();
  const orgId = membership!.org_id, uid = session!.user.id;
  const canAssign = can(membership!.role, 'task:write'), reports = can(membership!.role, 'report:read');
  // platform admins are never assigned tasks (they belong to no organization), so they see the open organization's totals
  const all = !!membership!.platform;
  const tasks = all ? '/tasks' : '/my-tasks';
  const { name, photo } = usePeople(orgId);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  // remembered per browser
  const [period, setPeriodState] = useState<Period>(() => { try { const v = localStorage.getItem('tt-dash-period'); return v === 'month' || v === 'all' ? v : 'week'; } catch { return 'week'; } });
  const setPeriod = (p: Period) => { setPeriodState(p); try { localStorage.setItem('tt-dash-period', p); } catch { /* storage blocked */ } };

  // live: reload when any task in this org changes (and on the clock every 2 minutes, so "due today" stays right)
  useLive(['tt_tasks', 'tt_task_assignees'], () => setTick((n) => n + 1));
  useEffect(() => {
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') setTick((n) => n + 1); }, 120_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    (async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      // the person's own tasks (what My Tasks shows); a platform admin's: every task in the organization
      const myTasks = (cols: string) => {
        const q = supabase.from('tt_tasks').select(all ? cols : `${cols}, tt_task_assignees!inner(user_id)`).eq('org_id', orgId);
        return (all ? q : q.eq('tt_task_assignees.user_id', uid)).is('archived_at', null);
      };
      try {
        const [sum, rows, next, current] = await Promise.all([
          rpc('tt_org_summary', { p_org: orgId, p_day_start: start.toISOString(), p_day_end: end.toISOString() }),
          fetchAll(() => myTasks('id, status, due_date, completed_at').order('id')),
          // up next: open tasks with a due date, the most overdue first
          myTasks('id, title, status, due_date').not('status', 'in', OPEN).not('due_date', 'is', null).order('due_date').limit(5),
          supabase.from('tt_tasks').select('id, title, status, tt_task_assignees(user_id)').eq('org_id', orgId).is('archived_at', null)
            .in('status', ['started', 'pending', 'not_yet_started']).order('updated_at', { ascending: false }).limit(100),
        ]);
        // one "currently working on" task per person, most recently updated first
        const working = new Map<string, any>();
        for (const t of current.data ?? []) for (const a of t.tt_task_assignees) if (!working.has(a.user_id)) working.set(a.user_id, t);
        setD({ rows, next: next.data ?? [], team: (sum.workload as any[]).filter((w) => w.open).slice(0, 6).map((w) => ({ ...w, task: working.get(w.user_id) })) });
      } catch (x) { setError((x as Error).message); }
    })();
  }, [orgId, uid, tick, all]);

  // recounted when the filter changes, without reloading; the clock tick keeps "overdue" and "due today" current
  const c = useMemo(() => countTasks(d?.rows ?? [], period), [d, period, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="card"><p role="alert">{error}</p></div>;
  if (!d) return <DashSkeleton />;

  const span = period === 'week' ? 'this week' : period === 'month' ? 'this month' : '';
  const total = c.done + c.open, pct = total ? Math.round((c.done / total) * 100) : 0;
  const share = (n: number) => `${total ? (n / total) * 100 : 0}%`;

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-sub">{all ? `How ${membership!.org_name} is doing ${span || 'across every task'}.` : `What needs your attention ${span || 'across all your tasks'}.`}</p>
        </div>
        <div className="page-actions">
          <div className="cc-ranges dash-period" role="group" aria-label="Period">
            {PERIODS.map(([p, l]) => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{l}</button>)}
          </div>
          {canAssign && <Link to="/tasks?new=1" className="pill-btn"><Plus size={16} aria-hidden="true" />Add task</Link>}
        </div>
      </div>

      <div className="dash">
        <div className="a-k1"><Kpi feature title={all ? 'Open tasks' : 'My open tasks'} value={c.open} note={span ? `Due ${span} · ${c.active} started` : `${c.active} started`} to={tasks} /></div>
        <div className="a-k2"><Kpi title="Overdue" tone="bad" value={c.overdue} note={c.overdue ? 'Past their due date' : 'Everything is on time'} to={`${tasks}?view=overdue`} /></div>
        <div className="a-k3"><Kpi title="Due today" value={c.dueToday} note="Before midnight" to={`${tasks}?view=due_today`} /></div>
        <div className="a-k4"><Kpi title="Pending" value={c.waiting} note="Waiting on something" to={`${tasks}?view=pending`} /></div>

        <section className="card a-an dpg" aria-labelledby="pg-h">
          <div className="dp-head">
            <div>
              <h3 id="pg-h">{all ? 'Team progress' : 'My progress'}</h3>
              <p className="dp-num"><b><CountUp value={c.done} /></b> completed{span ? ` ${span}` : ''}{total ? <> · <b>{pct}%</b> of {total} tasks</> : null}</p>
            </div>
            {reports && <Link to="/reports" className="mini-link"><BarChart3 size={15} aria-hidden="true" />Reports</Link>}
          </div>
          <div className="dp-split" role="img" aria-label={`${c.done} completed, ${c.active} started, ${c.pending} not started or pending`}>
            <i className="done" style={{ width: share(c.done) }} /><i className="active" style={{ width: share(c.active) }} /><i className="rest" style={{ width: share(c.pending) }} />
          </div>
          <ul className="dp-legend">
            <li><i className="done" />Completed <b>{c.done}</b></li><li><i className="active" />Started <b>{c.active}</b></li><li><i className="rest" />Not started or pending <b>{c.pending}</b></li>
          </ul>
          <h4 className="dp-sub">Completed {period === 'all' ? 'per month, last 12 months' : period === 'month' ? 'per week' : 'per day'}</h4>
          <CompletedBars rows={d.rows} period={period} />
        </section>

        <div className="a-re dash-side">
          <section className="card dn" aria-labelledby="re-h">
            <div className="panel-head"><h3 id="re-h">Up next</h3><Link to={tasks} className="mini-link">View all</Link></div>
            {d.next.length === 0 ? (
              <div className="dn-empty"><CalendarClock size={22} aria-hidden="true" /><p>No open tasks with a due date.</p></div>
            ) : (
              <ul className="dn-list">{d.next.map((t: any) => {
                const due = dueText(t.due_date);
                return (
                  <li key={t.id}><Link to={`/tasks/${t.id}`} title={`Due ${fmtTime(t.due_date)}`}>
                    <span className="dn-text"><b>{t.title}</b><small className={due.late ? 'late' : ''}>{due.text}</small></span>
                    <Badge v={t.status} /></Link></li>);
              })}</ul>
            )}
          </section>
  
          {canAssign && (
            <section className="card" aria-labelledby="tm-h">
              <div className="panel-head"><h3 id="tm-h">Team at work</h3>{can(membership!.role, 'members:manage') && <Link to="/employees" className="pill-btn ghost sm"><Plus size={14} aria-hidden="true" />Add member</Link>}</div>
              {d.team.length === 0 ? <p className="muted">Nobody has open work assigned.</p> : (
                <ul className="team">{d.team.map((w: any) => (
                  <li key={w.user_id}><Avatar name={name(w.user_id)} url={photo(w.user_id)} />
                    <span className="who"><b>{name(w.user_id)}</b><small>{w.task ? <>Working on <Link to={`/tasks/${w.task.id}`}>{w.task.title}</Link></> : `${w.open} open tasks`}</small></span>
                    <span className="tm-open" title="Open tasks">{w.open} open</span></li>))}
                </ul>)}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
