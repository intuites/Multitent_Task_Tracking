import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Building2, CalendarDays, CopyPlus, LayoutDashboard, ListChecks, Siren, UserRoundCheck, type LucideIcon,
} from 'lucide-react';
import { LiquidBg } from '../components/Liquid';
import { ThemeToggle } from '../components/Frame';

interface Feature { id: string; icon: LucideIcon; name: string; line: string; steps: string[]; visual: ReactNode }

const Flow = () => (
  <div className="gv gv-flow" aria-hidden="true">
    {['Not yet started', 'In progress', 'In review', 'Completed'].map((s, i) => <span key={s} className={`gv-step s${i}`} style={{ '--i': i } as React.CSSProperties}>{s}</span>)}
    <span className="gv-side">Blocked · Escalation · Cancelled can happen at any point</span>
  </div>
);
const DashMock = () => (
  <div className="gv gv-dash" aria-hidden="true">
    <div className="gv-kpi feat"><small>Open tasks</small><b>24</b></div><div className="gv-kpi"><small>Overdue</small><b>3</b></div>
    <div className="gv-bars">{[30, 55, 40, 80, 62, 20, 12].map((h, i) => <i key={i} style={{ height: `${h}%`, '--i': i } as React.CSSProperties} />)}</div>
  </div>
);
const EscMock = () => (
  <div className="gv gv-esc" aria-hidden="true">
    <div className="gv-card bad"><Siren size={16} /><b>Critical · Server outage</b><small>Raised 12 min ago · owner Priya</small></div>
    <div className="gv-timeline"><span>Open</span><span>Acknowledged</span><span>Resolved</span></div>
  </div>
);
const ListMock = ({ rows }: { rows: [string, string][] }) => (
  <div className="gv gv-list" aria-hidden="true">{rows.map(([a, b], i) => <div key={a} className="gv-row" style={{ '--i': i } as React.CSSProperties}><b>{a}</b><span>{b}</span></div>)}</div>
);
const CalMock = () => (
  <div className="gv gv-cal" aria-hidden="true">{Array.from({ length: 21 }, (_, i) => <span key={i} className={i === 9 ? 'today' : [4, 12, 17].includes(i) ? 'has' : ''}>{i + 1}</span>)}</div>
);
const ProgressMock = () => (
  <div className="gv gv-progress" aria-hidden="true">
    {[['Website redesign', 72], ['Mobile app', 45], ['Data migration', 90]].map(([n, p], i) => (
      <div key={n} className="gv-prog"><span>{n}</span><span className="gv-track"><i style={{ width: `${p}%`, '--i': i } as React.CSSProperties} /></span><b>{p}%</b></div>))}
  </div>
);

const FEATURES: Feature[] = [
  { id: 'dashboard', icon: LayoutDashboard, name: 'Dashboard', line: 'See what needs attention today the moment you sign in.',
    steps: ['Counts for open, overdue, due-today and in-review work.', 'Click any card to open that list of tasks.'], visual: <DashMock /> },
  { id: 'tasks', icon: ListChecks, name: 'Tasks and subtasks', line: 'Every task follows one clear path, and big work splits into subtasks.',
    steps: ['Create a task, assign people and set dates.', 'Add subtasks, each with its own owner and start date.', 'Move it from Not yet started to Completed.'], visual: <Flow /> },
  { id: 'templates', icon: CopyPlus, name: 'Task templates', line: 'Set up repeat work once, then create it in one click.',
    steps: ['Save the title, departments, assignee and subtasks as a template.', 'Use it to create the task and all its subtasks together.', 'The assignee’s team lead is notified first.'],
    visual: <ListMock rows={[['Client onboarding', '5 subtasks'], ['Monthly invoice run', '3 subtasks'], ['New hire setup', '4 subtasks']]} /> },
  { id: 'escalations', icon: Siren, name: 'Escalations', line: 'When work is stuck, raise it so it can’t be missed.',
    steps: ['A manager escalates the task with a reason and severity.', 'When it’s resolved, the task returns to where it was.'], visual: <EscMock /> },
  { id: 'clients', icon: Building2, name: 'Clients and projects', line: 'Keep every client, its sub-clients and their projects together.',
    steps: ['Add a client and any sub-clients under it.', 'Create projects and track their progress.'], visual: <ProgressMock /> },
  { id: 'portal', icon: UserRoundCheck, name: 'Client portal', line: 'Clients sign in and see only what you share.',
    steps: ['Give a contact portal access.', 'Mark tasks and files as visible to the client.'],
    visual: <ListMock rows={[['Website redesign', '72% done'], ['Launch checklist', 'In progress'], ['Brand guide.pdf', 'Shared']]} /> },
  { id: 'calendar', icon: CalendarDays, name: 'Calendar', line: 'Deadlines, start dates and milestones by month.',
    steps: ['Filter by person, priority or status.', 'Click a day to see its plan.'], visual: <CalMock /> },
  { id: 'reports', icon: BarChart3, name: 'Reports', line: 'Completion, workload and overdue work, ready to export.',
    steps: ['Pick a report and filter it.', 'Export the result as CSV.'], visual: <DashMock /> },
];

export default function Guide({ standalone = false }: { standalone?: boolean }) {
  const [active, setActive] = useState(FEATURES[0].id);
  // highlight the feature currently in view
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    FEATURES.map((f) => f.id).forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  // keep the active pill in view inside the horizontally scrolling bar (scrollTo, so the page itself doesn't jump)
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current, btn = nav?.querySelector<HTMLElement>('button.on');
    if (nav && btn) nav.scrollTo({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
  }, [active]);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className={standalone ? 'guide standalone' : 'guide'}>
      {standalone && (
        <header className="g-top">
          <span className="brand"><span className="mark" aria-hidden="true">T</span>Taskify</span>
          <span className="g-top-actions"><ThemeToggle /><a href="/" className="pill-btn">Sign in</a></span>
        </header>
      )}

      <section className="g-hero">
        <LiquidBg tone="deep" />
        <div className="g-hero-copy">
          <p className="g-kicker">Product guide</p>
          <h1>Run client work, tasks and escalations in one calm place.</h1>
          <p className="g-lead">The main features, and how each one works.</p>
          <div className="g-cta">
            <button type="button" className="pill-btn light" onClick={() => go(FEATURES[0].id)}>Explore features<ArrowRight size={16} aria-hidden="true" /></button>
            {standalone ? <a href="/" className="pill-btn g-ghost">Sign in</a> : <Link to="/" className="pill-btn g-ghost">Back to dashboard</Link>}
          </div>
        </div>
        <div className="g-hero-art" aria-hidden="true">
          <div className="g-float f1"><span className="dot ev-ms" />Task completed<small>Design landing page</small></div>
          <div className="g-float f2"><span className="dot ev-due" />Due tomorrow<small>QA sign-off</small></div>
          <div className="g-float f3"><span className="dot ev-esc" />Escalation resolved<small>Server outage</small></div>
        </div>
      </section>

      <nav className="g-nav" aria-label="Features" ref={navRef}>
        {FEATURES.map((f) => (
          <button key={f.id} type="button" className={active === f.id ? 'on' : ''} aria-current={active === f.id ? 'true' : undefined} onClick={() => go(f.id)}>
            <f.icon size={15} aria-hidden="true" />{f.name.split(' and ')[0]}
          </button>
        ))}
      </nav>

      {FEATURES.map((f, i) => (
        <section key={f.id} id={f.id} className={`g-feature ${i % 2 ? 'flip' : ''}`} aria-labelledby={`${f.id}-h`}>
          <div className="g-text reveal">
            <span className="g-ico"><f.icon size={22} aria-hidden="true" /></span>
            <h2 id={`${f.id}-h`}>{f.name}</h2>
            <p className="g-line">{f.line}</p>
            <h3>How it works</h3>
            <ol className="g-steps">{f.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
          <div className="g-visual reveal">{f.visual}</div>
        </section>
      ))}

      <section className="g-end">
        <LiquidBg />
        <h2>Ready when you are.</h2>
        {standalone ? <a href="/" className="pill-btn light">Sign in to Taskify</a> : <Link to="/" className="pill-btn light">Go to dashboard</Link>}
      </section>
    </div>
  );
}
