import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Building2, CalendarDays, CopyPlus, Layers, LayoutDashboard, ListChecks, RotateCcw, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { LiquidBg, reducedMotion } from '../components/Liquid';
import { ThemeToggle } from '../components/Frame';
import GuideHeroDemo from '../components/GuideHeroDemo';
import { DEMOS } from '../components/GuideDemos';

interface Feature { id: string; icon: LucideIcon; name: string; line: string; steps: string[] }
const css = (v: Record<string, string | number>) => v as React.CSSProperties;

const FEATURES: Feature[] = [
  { id: 'organizations', icon: Building2, name: 'Organizations', line: 'Whoever creates an organization is its admin. Nobody outside it can see its data.',
    steps: ['Create your organization; you become its admin.', 'Invite members as admin or employee.', 'Another organization never sees your people, departments or tasks.'] },
  { id: 'departments', icon: Layers, name: 'Departments', line: 'Group your members into departments, then assign work in three picks.',
    steps: ['Open Employees → Departments and choose the organization.', 'Add departments and the members in each.', 'When creating a task: organization, department, member.'] },
  { id: 'dashboard', icon: LayoutDashboard, name: 'Dashboard', line: 'See what needs attention today the moment you sign in.',
    steps: ['Counts for open, overdue, due-today and pending work.', 'Switch the period: this week, this month or all time.', 'Click any card to open that list of tasks.'] },
  { id: 'tasks', icon: ListChecks, name: 'Tasks and subtasks', line: 'Every task follows one clear path, and big work splits into subtasks.',
    steps: ['Pick the organization, then the department, then a member of that department.', 'Add subtasks, each with its own owner and date.', 'Mark it Future if the work starts later.'] },
  { id: 'reminders', icon: RotateCcw, name: 'Reminders and cycles', line: 'Recurring work reopens by itself, and reminders keep it moving.',
    steps: ['Set a reminder: once, daily, weekly, monthly, quarterly, every 6 months or yearly.', 'Mark it Completed this cycle; it reopens on the next cycle day.', 'Completed permanently stops every reminder.'] },
  { id: 'templates', icon: CopyPlus, name: 'Task templates', line: 'Set up repeat work once, then create it in one click.',
    steps: ['Save the title, departments, assignee and subtasks as a template.', 'Use it to create the task and all its subtasks together.'] },
  { id: 'calendar', icon: CalendarDays, name: 'Calendar', line: 'Deadlines and start dates by month.',
    steps: ['Filter by person, priority or status.', 'Click a day to see its plan.'] },
  { id: 'roles', icon: ShieldCheck, name: 'Roles', line: 'Two roles inside every organization, plus the platform team outside them.',
    steps: ['Admins manage members, departments and settings, and create and assign tasks to anyone.', 'Employees work on the tasks given to them and update their status.', 'Platform admins sit outside every organization and look after all of them.'] },
  { id: 'reports', icon: BarChart3, name: 'Reports', line: 'Completion, workload, departments and overdue work, ready to export.',
    steps: ['Pick a report and filter it.', 'Export it to Excel (with charts) or PDF.'] },
];
const HEADLINE = 'Assign work. Track it. Get it done on time.';

/** Pointer-driven tilt, written as CSS variables once per frame on the nearest [data-fx]. Skipped on touch and reduced motion. */
function usePointerFx(root: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    let raf = 0, last: PointerEvent | null = null;
    const frame = () => {
      raf = 0;
      const e = last!, hit = (e.target as Element).closest<HTMLElement>('[data-fx]');
      if (!hit) return;
      const r = hit.getBoundingClientRect();
      hit.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      hit.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
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
  // the feature in view drives the pinned 3D screen
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    FEATURES.forEach((f) => { const el = document.getElementById(f.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  // phones show each demo inline instead of the pinned screen
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)'), on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const nav = navRef.current, btn = nav?.querySelector<HTMLElement>('button.on');
    if (!nav || !btn) return;
    setInd({ x: btn.offsetLeft, w: btn.offsetWidth });
    nav.scrollTo({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
  }, [active]);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const idx = FEATURES.findIndex((f) => f.id === active);
  const Active = DEMOS[active];

  return (
    <div ref={rootRef} className={standalone ? 'guide standalone' : 'guide'}>
      <div className="g-ambient" aria-hidden="true"><span className="ga a1" /><span className="ga a2" /><span className="ga a3" /><span className="ga a4" /></div>
      {standalone && (
        <header className="g-top">
          <span className="brand"><span className="mark" aria-hidden="true">T</span>Taskify</span>
          <span className="g-top-actions"><ThemeToggle /><a href="/" className="pill-btn">Sign in</a></span>
        </header>
      )}

      <section className="g-hero" data-fx data-ss-tilt>
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
        <div className="g-hero-art" aria-hidden="true">
          {/* the demo on a tilted plane, with two screens stacked behind it in depth */}
          <div className="g-plane" data-ss-tilt>
            <span className="g-depth d2" /><span className="g-depth d1" />
            <GuideHeroDemo />
          </div>
        </div>
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

      {/* scrollytelling: explanations scroll on the left; one pinned 3D screen on the right plays the feature being read */}
      <section className="g-story" aria-label="Features in detail">
        <div className="g-story-steps">
          {FEATURES.map((f, i) => {
            const Demo = DEMOS[f.id];
            return (
              <article key={f.id} id={f.id} className={`g-step ${active === f.id ? 'on' : ''}`} aria-labelledby={`${f.id}-h`}>
                <span className="g-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="g-ico"><f.icon size={22} aria-hidden="true" /></span>
                <h2 id={`${f.id}-h`}>{f.name}</h2>
                <p className="g-line">{f.line}</p>
                <ol className="g-steps">{f.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                {narrow && <div className="g-step-visual" aria-hidden="true"><div className="g-card3d" data-ss-tilt data-fx><Demo /></div></div>}
              </article>
            );
          })}
        </div>
        {!narrow && (
          <div className="g-stage" aria-hidden="true">
            <div className="g-device" data-fx data-ss-tilt>
              <span className="g-depth d2" /><span className="g-depth d1" />
              <div key={active} className="g-flip" data-ss-tilt><Active /></div>
            </div>
            <div className="g-dots"><span className="g-count">{String(idx + 1).padStart(2, '0')} / {String(FEATURES.length).padStart(2, '0')}</span>{FEATURES.map((f) => <span key={f.id} className={active === f.id ? 'on' : ''} />)}</div>
          </div>
        )}
      </section>

      {/* every feature on one turning ring */}
      <section className="g-ring-wrap" aria-labelledby="g-ring-h">
        <h2 id="g-ring-h">Everything in one place</h2>
        <p className="g-line">Nine parts of Taskify, one sign-in. Pick any to jump to it.</p>
        <div className="g-ring-scene">
          <ul className="g-ring" style={css({ '--n': FEATURES.length })}>
            {FEATURES.map((f, i) => (
              <li key={f.id} style={css({ '--i': i })}>
                <button type="button" className="g-ring-card" onClick={() => go(f.id)}>
                  <span className="g-ico"><f.icon size={20} aria-hidden="true" /></span>
                  <b>{f.name}</b>
                  <span>{f.line}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="g-end" data-fx>
        <LiquidBg />
        <span className="g-orb end" aria-hidden="true" />
        <div className="g-stack" aria-hidden="true">
          {([['Quarterly VAT filing', 'Started', 'b-started'], ['Monthly invoice run', 'Completed', 'b-completed'], ['Client onboarding', 'Not yet started', '']] as const).map(([t, st, b], i) => (
            <span key={t} className="g-stack-card" style={css({ '--i': i })}><b>{t}</b><span className={`badge ${b}`}>{st}</span></span>
          ))}
        </div>
        <h2>Ready when you are.</h2>
        {standalone ? <a href="/" className="pill-btn light g-shine">Sign in to Taskify</a> : <Link to="/" className="pill-btn light g-shine">Go to dashboard</Link>}
      </section>
    </div>
  );
}
