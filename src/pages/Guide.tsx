import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, BellRing, BookOpen, Building2, CalendarDays, CheckCircle2, CopyPlus, Layers, LayoutDashboard, ListChecks, RotateCcw, ShieldCheck, Users, type LucideIcon,
} from 'lucide-react';
import { reducedMotion } from '../components/Liquid';
import { ThemeToggle } from '../components/Frame';

interface Feature { id: string; icon: LucideIcon; name: string; line: string; steps: string[]; visual: ReactNode }
const css = (v: Record<string, string | number>) => v as React.CSSProperties;

const Flow = () => (
  <div className="gv-flow">
    {['Not yet started', 'Started', 'Pending', 'Completed this cycle', 'Completed'].map((s, i) => <span key={s} className="gv-step" style={css({ '--i': i })}>{s}</span>)}
    <span className="gv-side">Any step can change to any other.</span>
  </div>
);
const DashMock = () => (
  <div className="gv-dash">
    <div className="gv-kpi feat"><small>Open tasks</small><b>24</b></div><div className="gv-kpi"><small>Overdue</small><b>3</b></div>
    <div className="gv-bars">{[30, 55, 40, 80, 62, 20, 12].map((h, i) => <i key={i} style={css({ height: `${h}%`, '--i': i })} />)}</div>
  </div>
);
const CycleMock = () => (
  <div className="gv-cycle">
    <div className="gv-orbit"><span className="gv-orbit-ring" /><RotateCcw size={26} /><b>Monthly</b><small>Reopens on the 1st</small></div>
    <div className="gv-chips">{['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Every 6 months', 'Yearly'].map((c, i) => <span key={c} style={css({ '--i': i })}>{c}</span>)}</div>
    <div className="gv-bell"><BellRing size={16} />Reminder · Every weekday at 9:00 AM ET</div>
  </div>
);
const ListMock = ({ rows }: { rows: [string, string][] }) => (
  <div className="gv-list">{rows.map(([a, b], i) => <div key={a} className="gv-row" style={css({ '--i': i })}><b>{a}</b><span>{b}</span></div>)}</div>
);
const CalMock = () => (
  <div className="gv-cal">{Array.from({ length: 21 }, (_, i) => <span key={i} className={i === 9 ? 'today' : [4, 12, 17].includes(i) ? 'has' : ''} style={css({ '--i': i })}>{i + 1}</span>)}</div>
);
const AssignMock = () => (
  <div className="gv-stack">
    <div className="gv-timeline"><span>Organization</span><span>Department</span><span>Member</span></div>
    <ListMock rows={[['Finance', '4 members'], ['Operations', '7 members'], ['Sales', '5 members']]} />
  </div>
);

const FEATURES: Feature[] = [
  { id: 'organizations', icon: Building2, name: 'Organizations', line: 'Whoever creates an organization is its admin. Nobody outside it can see its data.',
    steps: ['Create your organization; you become its admin.', 'Invite members as admin or employee.', 'Another organization never sees your people, departments or tasks.'],
    visual: <ListMock rows={[['Acme Corp', 'Only Acme’s members'], ['Northwind', 'Only Northwind’s members'], ['Globex', 'Only Globex’s members']]} /> },
  { id: 'departments', icon: Layers, name: 'Departments', line: 'Group your members into departments, then assign work in three picks.',
    steps: ['Open Employees → Departments and choose the organization.', 'Add departments and the members in each.', 'When creating a task: organization, department, member.'], visual: <AssignMock /> },
  { id: 'dashboard', icon: LayoutDashboard, name: 'Dashboard', line: 'See what needs attention today the moment you sign in.',
    steps: ['Counts for open, overdue, due-today and pending work.', 'Click any card to open that list of tasks.'], visual: <DashMock /> },
  { id: 'tasks', icon: ListChecks, name: 'Tasks and subtasks', line: 'Every task follows one clear path, and big work splits into subtasks.',
    steps: ['Pick the organization, then the department, then a member of that department.', 'Add subtasks, each with its own owner and date.', 'Mark it Future if the work starts later.'], visual: <Flow /> },
  { id: 'reminders', icon: RotateCcw, name: 'Reminders and cycles', line: 'Recurring work reopens by itself, and reminders keep it moving.',
    steps: ['Set a reminder: once, daily, weekly, monthly, quarterly, every 6 months or yearly.', 'Mark it Completed this cycle; it reopens on the next cycle day.', 'Completed permanently stops every reminder.'], visual: <CycleMock /> },
  { id: 'templates', icon: CopyPlus, name: 'Task templates', line: 'Set up repeat work once, then create it in one click.',
    steps: ['Save the title, departments, assignee and subtasks as a template.', 'Use it to create the task and all its subtasks together.'],
    visual: <ListMock rows={[['Client onboarding', '5 subtasks'], ['Monthly invoice run', '3 subtasks'], ['New hire setup', '4 subtasks']]} /> },
  { id: 'calendar', icon: CalendarDays, name: 'Calendar', line: 'Deadlines and start dates by month.',
    steps: ['Filter by person, priority or status.', 'Click a day to see its plan.'], visual: <CalMock /> },
  { id: 'roles', icon: ShieldCheck, name: 'Roles', line: 'Two roles inside every organization, plus the platform team outside them.',
    steps: ['Admins manage members, departments and settings, and create and assign tasks to anyone.', 'Employees work on the tasks given to them and update their status.', 'Platform admins sit outside every organization and look after all of them.'],
    visual: <ListMock rows={[['Admin', 'People, departments, tasks, settings'], ['Employee', 'Works on their tasks'], ['Platform admin', 'Looks after every organization']]} /> },
  { id: 'reports', icon: BarChart3, name: 'Reports', line: 'Completion, workload, departments and overdue work, ready to export.',
    steps: ['Pick a report and filter it.', 'Export it to Excel (with charts) or PDF.'], visual: <DashMock /> },
];
const HEADLINE = 'Assign work. Track it. Get it done on time.';

/** Marks [data-rv] elements as they scroll into view (an attribute, so React re-rendering classes keeps it) and counts up [data-count]. */
function useReveal(root: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current; if (!el) return;
    const still = reducedMotion();
    const count = (n: HTMLElement) => {
      const to = Number(n.dataset.count), t0 = performance.now();
      if (still) { n.textContent = String(to); return; }
      const step = (t: number) => { const p = Math.min(1, (t - t0) / 900); n.textContent = String(Math.round(to * (1 - (1 - p) ** 3))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      const n = e.target as HTMLElement;
      n.setAttribute('data-in', '');
      n.querySelectorAll<HTMLElement>('[data-count]').forEach(count);
      io.unobserve(n);
    }), { rootMargin: '0px 0px -10% 0px' });
    el.querySelectorAll('[data-rv]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root]);
}

/** The hero's live demo: one task moving through its day, on a loop (pure CSS; still and complete with reduced motion). */
function LiveTask() {
  return (
    <div className="gd-demo" aria-hidden="true">
      <div className="gd-win">
        <div className="gd-win-top"><span className="gd-org"><i />ABC Pvt Ltd</span><span className="gd-live"><i />Live</span></div>
        <div className="gd-task">
          <div className="gd-task-k"><span>Finance</span><span className="gd-due">Due tomorrow, 17:00</span></div>
          <h3>QA sign&#8209;off for the October release</h3>
          <div className="gd-who"><span className="gd-av">PS</span><span className="gd-who-t"><b>Priya Sharma</b><small>assigned just now</small></span><span className="gd-prio">High</span></div>
          <div className="gd-path">
            {['Not started', 'Started', 'Pending', 'Completed'].map((s, i) => <span key={s} className={`gd-st s${i}`}>{s}</span>)}
            <span className="gd-pill" />
          </div>
          <div className="gd-subs">
            {['Collect signed test reports', 'Check every line against the ledger', 'Send the summary to the client'].map((s, i) => (
              <div key={s} className={`gd-sub u${i}`}><span className="gd-box"><svg viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg></span>{s}</div>))}
          </div>
          <div className="gd-prog"><i /></div>
        </div>
      </div>
      <div className="gd-chip c1"><RotateCcw size={14} />Reminder · monthly</div>
      <div className="gd-chip c2"><BellRing size={14} />Email sent to Priya</div>
      <div className="gd-toast"><span className="gd-tick"><svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7" /></svg></span><span><b>Completed on time</b><small>QA sign-off · 16:40</small></span></div>
    </div>
  );
}

export default function Guide({ standalone = false }: { standalone?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [active, setActive] = useState(FEATURES[0].id);
  // highlight the feature currently in view
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    FEATURES.forEach((f) => { const el = document.getElementById(f.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  // slide the indicator under the active tab and keep that tab in view inside the scrolling bar
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const nav = navRef.current, btn = nav?.querySelector<HTMLElement>('button.on');
    if (!nav || !btn) return;
    setInd({ x: btn.offsetLeft, w: btn.offsetWidth });
    nav.scrollTo({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active]);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  const current = FEATURES.find((f) => f.id === active)!;
  const HEAD = ['Assign', 'work.', 'Track', 'it.', 'Get', 'it', 'done'];

  return (
    <div ref={rootRef} className={standalone ? 'gd standalone' : 'gd'}>
      {standalone && (
        <header className="gd-top">
          <span className="brand"><span className="mark" aria-hidden="true">T</span>Taskify</span>
          <span className="gd-top-actions"><ThemeToggle /><a href="/" className="pill-btn">Sign in</a></span>
        </header>
      )}

      <section className="gd-hero">
        <div className="gd-hero-bg" aria-hidden="true" />
        <div className="gd-hero-copy">
          <p className="gd-kick" data-rv><BookOpen size={15} aria-hidden="true" />Product guide</p>
          <h1 aria-label={HEADLINE}>
            {HEAD.map((w, i) => <span key={i} className="gd-w" aria-hidden="true" style={css({ '--i': i })}>{w} </span>)}
            <span className="gd-w gd-mark" aria-hidden="true" style={css({ '--i': HEAD.length })}>on time.<svg viewBox="0 0 300 20" preserveAspectRatio="none"><path d="M4 14 C 80 4, 200 4, 296 12" /></svg></span>
          </h1>
          <p className="gd-lead" data-rv style={css({ '--i': 2 })}>Taskify gives each organization one place to assign tasks to its departments and people, follow every status, and stay on deadline with reminders, email updates and reports.</p>
          <div className="gd-cta" data-rv style={css({ '--i': 3 })}>
            <button type="button" className="pill-btn gd-primary" onClick={() => go(FEATURES[0].id)}>Explore features<ArrowRight size={16} aria-hidden="true" /></button>
            {standalone ? <a href="/" className="pill-btn ghost">Sign in</a> : <Link to="/" className="pill-btn ghost">Back to dashboard</Link>}
          </div>
          <dl className="gd-facts" data-rv style={css({ '--i': 4 })}>
            <div><dt><span data-count="9">9</span></dt><dd>Features</dd></div>
            <div><dt><span data-count="2">2</span></dt><dd>Roles</dd></div>
            <div><dt><span data-count="7">7</span></dt><dd>Reminder cycles</dd></div>
          </dl>
        </div>
        <LiveTask />
      </section>

      <nav className="gd-nav" aria-label="Features" ref={navRef}>
        <span className="gd-ind" aria-hidden="true" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} />
        {FEATURES.map((f) => (
          <button key={f.id} type="button" className={active === f.id ? 'on' : ''} aria-current={active === f.id ? 'true' : undefined} onClick={() => go(f.id)}>
            <f.icon size={15} aria-hidden="true" />{f.name.split(' and ')[0]}
          </button>
        ))}
      </nav>

      {/* explanations scroll on the left; the window on the right shows the feature being read */}
      <section className="gd-story" aria-label="Features in detail">
        <div className="gd-steps">
          {FEATURES.map((f, i) => (
            <article key={f.id} id={f.id} className={`gd-step ${active === f.id ? 'on' : ''}`} aria-labelledby={`${f.id}-h`} data-rv>
              <span className="gd-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="gd-ico"><f.icon size={20} aria-hidden="true" /></span>
              <h2 id={`${f.id}-h`}>{f.name}</h2>
              <p className="gd-line">{f.line}</p>
              <ol className="gd-list">{f.steps.map((s, j) => <li key={s} style={css({ '--j': j })}>{s}</li>)}</ol>
              <div className="gd-step-visual gv" aria-hidden="true">{f.visual}</div>
            </article>
          ))}
        </div>
        <div className="gd-stage" aria-hidden="true">
          <div className="gd-frame">
            <div className="gd-frame-top"><current.icon size={15} /><span key={active} className="gd-frame-title">{current.name}</span>
              <span className="gd-dots">{FEATURES.map((f) => <i key={f.id} className={active === f.id ? 'on' : ''} />)}</span></div>
            <div key={active} className="gd-screen gv">{current.visual}</div>
          </div>
        </div>
      </section>

      <section className="gd-flow" aria-labelledby="gd-flow-h" data-rv>
        <h2 id="gd-flow-h">From the first pick to done</h2>
        <p className="gd-line">Three picks put a name on the work. One status path takes it to the finish.</p>
        <ol className="gd-track">
          {[['Organization', Building2], ['Department', Layers], ['Person', Users], ['Started', ListChecks], ['Completed', CheckCircle2]].map(([n, Ic], i) => {
            const I = Ic as LucideIcon;
            return <li key={n as string} style={css({ '--i': i })}><span className="gd-node"><I size={18} aria-hidden="true" /></span><b>{n as string}</b></li>;
          })}
        </ol>
      </section>

      <section className="gd-end" data-rv>
        <span className="gd-end-tick" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" /><path d="M14 25 21 32 34 17" /></svg></span>
        <h2>Ready to assign the first task</h2>
        <p>Pick a department, a person and a date, and Taskify follows it all the way to done.</p>
        {standalone ? <a href="/" className="pill-btn gd-end-btn">Sign in to Taskify<ArrowRight size={16} aria-hidden="true" /></a>
          : <Link to="/" className="pill-btn gd-end-btn">Go to dashboard<ArrowRight size={16} aria-hidden="true" /></Link>}
      </section>
    </div>
  );
}
