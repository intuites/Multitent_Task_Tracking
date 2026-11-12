import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, BellRing, Building2, CalendarDays, CopyPlus, Layers, LayoutDashboard, ListChecks, RotateCcw, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { LiquidBg, reducedMotion } from '../components/Liquid';
import { ThemeToggle } from '../components/Frame';
import GuideHeroDemo from '../components/GuideHeroDemo';

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

/** Pointer-driven tilt / spotlight / parallax, written as CSS variables once per frame. Skipped on touch and reduced motion. */
function usePointerFx(root: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    let raf = 0, last: PointerEvent | null = null;
    const frame = () => {
      raf = 0;
      const e = last!, t = e.target as Element;
      const hit = t.closest<HTMLElement>('[data-fx]');
      if (!hit) return;
      const r = hit.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      hit.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      hit.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      hit.style.setProperty('--px', (x - 0.5).toFixed(3));
      hit.style.setProperty('--py', (y - 0.5).toFixed(3));
    };
    const move = (e: PointerEvent) => { last = e; if (!raf) raf = requestAnimationFrame(frame); };
    const out = (e: PointerEvent) => {
      const hit = (e.target as Element).closest<HTMLElement>('[data-fx]');
      if (hit && !hit.contains(e.relatedTarget as Node)) { hit.style.setProperty('--px', '0'); hit.style.setProperty('--py', '0'); }
    };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerout', out, { passive: true });
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerout', out); cancelAnimationFrame(raf); };
  }, [root]);
}

export default function Guide({ standalone = false }: { standalone?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePointerFx(rootRef);
  const [active, setActive] = useState(FEATURES[0].id);
  // highlight the feature currently in view
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    FEATURES.forEach((f) => { const el = document.getElementById(f.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  // slide the liquid pill under the active link and keep it in view inside the scrolling bar
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const nav = navRef.current, btn = nav?.querySelector<HTMLElement>('button.on');
    if (!nav || !btn) return;
    setInd({ x: btn.offsetLeft, w: btn.offsetWidth });
    nav.scrollTo({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
  }, [active]);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div ref={rootRef} className={standalone ? 'guide standalone' : 'guide'}>
      <div className="g-ambient" aria-hidden="true"><span className="ga a1" /><span className="ga a2" /><span className="ga a3" /><span className="ga a4" /></div>
      {standalone && (
        <header className="g-top">
          <span className="brand"><span className="mark" aria-hidden="true">T</span>Taskify</span>
          <span className="g-top-actions"><ThemeToggle /><a href="/" className="pill-btn">Sign in</a></span>
        </header>
      )}

      <section className="g-hero" data-fx>
        <LiquidBg tone="deep" />
        <span className="g-orb" aria-hidden="true" />
        <div className="g-hero-copy">
          <p className="g-kicker"><span className="g-kdot" aria-hidden="true" />Product guide</p>
          <h1 aria-label={HEADLINE}>{HEADLINE.split(' ').map((w, i) => <span key={i} className="g-word" aria-hidden="true" style={css({ '--i': i })}>{w} </span>)}</h1>
          <p className="g-lead">Taskify gives each organization one place to assign tasks to its departments and people, follow every status, and stay on deadline with reminders, email updates and reports.</p>
          <div className="g-cta">
            <button type="button" className="pill-btn light g-shine" onClick={() => go(FEATURES[0].id)}>Explore features<ArrowRight size={16} aria-hidden="true" /></button>
            {standalone ? <a href="/" className="pill-btn g-ghost">Sign in</a> : <Link to="/" className="pill-btn g-ghost">Back to dashboard</Link>}
          </div>
        </div>
        <div className="g-hero-art" aria-hidden="true"><GuideHeroDemo /></div>
      </section>

      <nav className="g-nav" aria-label="Features" ref={navRef}>
        <span className="g-ind" aria-hidden="true" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} />
        {FEATURES.map((f) => (
          <button key={f.id} type="button" className={active === f.id ? 'on' : ''} aria-current={active === f.id ? 'true' : undefined} onClick={() => go(f.id)}>
            <f.icon size={15} aria-hidden="true" />{f.name.split(' and ')[0]}
          </button>
        ))}
        <span className="g-progress" aria-hidden="true" />
      </nav>

      {/* scrollytelling: explanations scroll on the left, one pinned 3D app window on the right switches to the feature being read */}
      <section className="g-story" aria-label="Features in detail">
        <div className="g-story-steps">
          {FEATURES.map((f) => (
            <article key={f.id} id={f.id} className={`g-step ${active === f.id ? 'on' : ''}`} aria-labelledby={`${f.id}-h`}>
              <span className="g-ico"><f.icon size={22} aria-hidden="true" /></span>
              <h2 id={`${f.id}-h`}>{f.name}</h2>
              <p className="g-line">{f.line}</p>
              <ol className="g-steps">{f.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              <div className="g-step-visual" aria-hidden="true"><div className="gv">{f.visual}</div></div>
            </article>
          ))}
        </div>
        <div className="g-stage" aria-hidden="true">
          <div className="g-window" data-fx>
            <div className="g-win-bar"><i /><i /><i /><span key={active} className="g-win-title">{FEATURES.find((f) => f.id === active)?.name}</span></div>
            <div className="g-win-body">
              {FEATURES.filter((f) => f.id === active).map((f) => <div key={f.id} className="g-screen gv">{f.visual}<span className="gv-sheen" /></div>)}
            </div>
          </div>
          <div className="g-dots">{FEATURES.map((f) => <span key={f.id} className={active === f.id ? 'on' : ''} />)}</div>
        </div>
      </section>

      <section className="g-end" data-fx>
        <LiquidBg />
        <span className="g-orb end" aria-hidden="true" />
        <h2>Ready when you are.</h2>
        {standalone ? <a href="/" className="pill-btn light g-shine">Sign in to Taskify</a> : <Link to="/" className="pill-btn light g-shine">Go to dashboard</Link>}
      </section>
    </div>
  );
}
