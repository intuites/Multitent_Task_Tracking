import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown, ArrowRight, ArrowUp, BarChart3, BellRing, Building2, CalendarDays, CopyPlus, Layers, LayoutDashboard, ListChecks, Minus, Plus, RotateCcw, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { reducedMotion } from '../components/Liquid';

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
const STATIONS = [['Not yet started', 'created'], ['Started', 'someone is on it'], ['Pending', 'waiting on input'], ['Completed', 'done, on time']] as const;

/** The element that scrolls this page: the app's content area, or the window on the public guide. */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; }
  return null;
}

/** Scroll and pointer choreography, written as CSS variables once per frame:
 *  --hs hero scrolled away (0 to 1), --jp how far the pinned journey has run (0 to 1), --ss showcase arriving (0 to 1), --px/--py pointer over the hero.
 *  Also marks [data-rv] elements data-in as they enter (an attribute, so React re-rendering the class list keeps it). Reduced motion: everything shown, nothing moves. */
function useChoreography(root: React.RefObject<HTMLDivElement>, setStation: (i: number) => void) {
  useEffect(() => {
    const el = root.current; if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.setAttribute('data-in', ''); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
    el.querySelectorAll('[data-rv]').forEach((n) => io.observe(n));
    if (reducedMotion()) { el.querySelectorAll('[data-rv]').forEach((n) => n.setAttribute('data-in', '')); return () => io.disconnect(); }
    const sc = scroller(el), hero = el.querySelector<HTMLElement>('.gx-hero'), jr = el.querySelector<HTMLElement>('.gx-journey'), show = el.querySelector<HTMLElement>('.gx-show');
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    let raf = 0, last = -1;
    const frame = () => {
      raf = 0;
      const vh = sc ? sc.clientHeight : window.innerHeight, top = sc ? sc.getBoundingClientRect().top : 0;
      if (hero) { const r = hero.getBoundingClientRect(); el.style.setProperty('--hs', clamp((top - r.top) / r.height).toFixed(3)); }
      if (jr) {
        const r = jr.getBoundingClientRect(), p = clamp((top - r.top) / Math.max(1, r.height - vh));
        el.style.setProperty('--jp', p.toFixed(3));
        const i = Math.min(STATIONS.length - 1, Math.floor(p * STATIONS.length * 0.999));
        if (i !== last) { last = i; setStation(i); }
      }
      if (show) { const r = show.getBoundingClientRect(); el.style.setProperty('--ss', clamp((top + vh - r.top) / (vh * 0.9)).toFixed(3)); }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const fine = window.matchMedia('(pointer: fine)').matches;
    const onMove = (e: PointerEvent) => {
      if (!hero || !fine) return;
      const r = hero.getBoundingClientRect();
      el.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      el.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    };
    const onLeave = () => { el.style.setProperty('--px', '0'); el.style.setProperty('--py', '0'); };
    frame();
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    hero?.addEventListener('pointermove', onMove, { passive: true });
    hero?.addEventListener('pointerleave', onLeave);
    return () => {
      io.disconnect(); cancelAnimationFrame(raf);
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      hero?.removeEventListener('pointermove', onMove); hero?.removeEventListener('pointerleave', onLeave);
    };
  }, [root, setStation]);
}

/** The sample task the page follows: in the hero, along the journey and in the closing stamp. */
function TaskCard({ small }: { small?: boolean }) {
  return (
    <div className={`gx-card${small ? ' sm' : ''}`}>
      <div className="gx-k"><span>Task · FIN-214</span><span>High</span></div>
      <h3>{small ? 'QA sign‑off' : 'QA sign‑off for the October release'}</h3>
      <div className="gx-path">{small ? 'Priya Sharma · due Nov 13' : 'ABC Pvt Ltd → Finance → Priya Sharma'}</div>
      {!small && <>
        <svg className="gx-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="50" className="t" /><circle cx="60" cy="60" r="50" className="f" strokeDasharray="105 314" transform="rotate(-90 60 60)" />
          <text x="60" y="60" textAnchor="middle" className="n">1/3</text><text x="60" y="78" textAnchor="middle" className="l">subtasks</text>
        </svg>
        <div className="gx-stamp"><small>Due</small>Nov 13 · 17:00</div>
        <div className="gx-rows">
          <div><span className="bx on" /><s>Collect signed test reports</s><time>RK · Nov 10</time></div>
          <div><span className="bx" />Check every line against the ledger<time>PS · Nov 12</time></div>
          <div><span className="bx" />Send the summary to the client<time>MI · Nov 13</time></div>
        </div>
      </>}
    </div>
  );
}

export default function Guide({ standalone = false }: { standalone?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [station, setStation] = useState(1);
  const [open, setOpen] = useState(FEATURES[0].id);
  useChoreography(rootRef, setStation);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  // a link to /guide#reminders opens that feature
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (FEATURES.some((f) => f.id === id)) { setOpen(id); requestAnimationFrame(() => go(id)); }
  }, []);
  const home = standalone ? <a href="/" className="gx-b1">Sign in to Taskify<span className="ar"><ArrowRight size={15} /></span></a>
    : <Link to="/" className="gx-b1">Go to dashboard<span className="ar"><ArrowRight size={15} /></span></Link>;

  return (
    <div ref={rootRef} className={`gx${standalone ? ' standalone' : ''}`}>
      {/* 01 */}
      <section className="gx-hero" aria-labelledby="gx-h1">
        <nav className="gx-nav" aria-label="Guide">
          <span className="gx-logo"><i aria-hidden="true" />Taskify</span>
          <button type="button" onClick={() => go('gx-idea')}>The idea</button>
          <button type="button" onClick={() => go('gx-journey')}>How it works</button>
          <button type="button" onClick={() => go('gx-features')}>Features</button>
          <span className="sp" />
          {standalone ? <a href="/" className="gx-nbtn">Sign in</a> : <Link to="/" className="gx-nbtn">Open dashboard</Link>}
        </nav>
        <div className="gx-glint" aria-hidden="true" />
        <div className="gx-stage" aria-hidden="true"><div className="gx-deck">
          <div className="gx-shadow" />
          {[0, 1, 2, 3].map((i) => <div key={i} className="gx-slab" style={css({ '--z': i })} />)}
          <div className="gx-lift"><TaskCard /></div>
        </div></div>
        <div className="gx-copy">
          <p className="gx-tag" data-rv><b>01</b> — The Taskify guide</p>
          <h1 id="gx-h1" aria-label="Assign it. Track it. Done on time.">
            {['Assign it.', <><em>Track</em> it.</>, 'Done on time.'].map((l, i) => <span key={i} className={`ln l${i}`} data-rv style={css({ '--i': i })}>{l}</span>)}
          </h1>
        </div>
        <div className="gx-low" data-rv>
          <p>Taskify gives each organization one place to assign tasks to its departments and people, follow every status, and stay on deadline with reminders, email updates and reports.</p>
          <div className="gx-cta">
            <button type="button" className="gx-b1" onClick={() => go('gx-idea')}>Explore the guide<span className="ar"><ArrowDown size={15} /></span></button>
            {standalone ? <a href="/" className="gx-b2">Sign in</a> : <Link to="/" className="gx-b2">Back to dashboard</Link>}
          </div>
        </div>
        <span className="gx-scroll" aria-hidden="true">Scroll<i /></span>
      </section>

      {/* 02 */}
      <section id="gx-idea" className="gx-idea" aria-labelledby="gx-idea-h">
        <p className="gx-tag" data-rv><b>02</b> — The idea</p>
        <p id="gx-idea-h" className="gx-big" data-rv>Every task gets <em>an owner,</em> a date, and a clear path <span className="g">from the moment it’s assigned to the moment it’s</span> done.</p>
        <div className="gx-meta">
          {[['Organization → Department → Person', 'Three picks and the work has a name on it.'], ['Not yet started → Started → Pending → Completed', 'One status path, the same for everyone.'],
            ['Once · daily · weekly · monthly · yearly', 'Recurring work reopens on its own.']].map(([a, b], i) => (
            <div key={a} data-rv style={css({ '--i': i })}><b>{a}</b>{b}</div>))}
        </div>
      </section>

      {/* 03: pinned while the task travels its status path */}
      <section id="gx-journey" className="gx-journey" aria-labelledby="gx-j-h">
        <div className="gx-pin">
          <div className="gx-jhead"><p className="gx-tag"><b>03</b> — The journey of one task</p><h2 id="gx-j-h">Watch it move <em>toward done.</em></h2></div>
          <div className="gx-track" aria-hidden="true"><div className="gx-plane">
            <div className="gx-rail" /><div className="gx-rail lit" />
            {STATIONS.map((s, i) => <div key={s[0]} className={`gx-pad${i === station ? ' on' : i < station ? ' past' : ''}`} style={css({ '--i': i })} />)}
          </div></div>
          <div className="gx-trail" aria-hidden="true" />
          <div className="gx-trav" aria-hidden="true"><TaskCard small /><span className="gx-trav-st">{STATIONS[station][0]}</span></div>
          <ol className="gx-stations">
            {STATIONS.map(([n, d], i) => <li key={n} className={i === station ? 'on' : i < station ? 'past' : ''} aria-current={i === station ? 'step' : undefined}><b>{n}</b><span>{d}</span></li>)}
          </ol>
        </div>
      </section>

      {/* 04: every feature as an index; one open at a time */}
      <section id="gx-features" className="gx-feat" aria-labelledby="gx-f-h">
        <div className="gx-fhead"><div><p className="gx-tag" data-rv><b>04</b> — What it does</p><h2 id="gx-f-h" data-rv>Nine parts, one system</h2></div><span className="gx-tag">01 — 09</span></div>
        <div className="gx-idx">
          {FEATURES.map((f, i) => {
            const on = open === f.id;
            return (
              <article key={f.id} id={f.id} className={`gx-row${on ? ' open' : ''}`} data-rv>
                <button type="button" className="gx-rh" aria-expanded={on} aria-controls={`${f.id}-b`} onClick={() => setOpen(on ? '' : f.id)}>
                  <span className="n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="t"><f.icon size={18} aria-hidden="true" />{f.name}</span>
                  <span className="d">{f.line}</span>
                  <span className="pl" aria-hidden="true">{on ? <Minus size={16} /> : <Plus size={16} />}</span>
                </button>
                <div id={`${f.id}-b`} className="gx-rb" hidden={!on}>
                  <ol>{f.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  <div className="gx-vis gv" aria-hidden="true">{f.visual}</div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* 05 */}
      <section className="gx-show" aria-labelledby="gx-s-h">
        <div className="gx-cap"><div><p className="gx-tag" data-rv><b>05</b> — The dashboard</p><h2 id="gx-s-h" data-rv>The whole team,<br /><em>at a glance.</em></h2></div>
          <p data-rv>Open, overdue, due-today and pending work the moment you sign in. Click any number to open that list.</p></div>
        <div className="gx-persp" aria-hidden="true"><div className="gx-app">
          <aside><b><i />ABC Pvt Ltd</b>{['Dashboard', 'My tasks', 'Tasks', 'Calendar', 'Employees', 'Reports'].map((n, i) => <span key={n} className={i ? '' : 'on'}>{n}</span>)}</aside>
          <div className="gx-mainv">
            <div className="gx-k4">{[['Open tasks', 24], ['Overdue', 3], ['Due today', 6], ['Pending', 4]].map(([l, v], i) => <div key={l} className={i ? '' : 'a'}><small>{l}</small><b>{v}</b></div>)}</div>
            <div className="gx-ch"><svg viewBox="0 0 900 300" preserveAspectRatio="none">
              <g className="g"><line x1="0" x2="900" y1="60" y2="60" /><line x1="0" x2="900" y1="140" y2="140" /><line x1="0" x2="900" y1="220" y2="220" /></g>
              <path className="a" d="M0 250 C90 240 130 220 200 210 S320 170 390 160 S510 140 580 110 S710 70 780 60 S860 44 900 36 L900 300 L0 300Z" />
              <path className="l" d="M0 250 C90 240 130 220 200 210 S320 170 390 160 S510 140 580 110 S710 70 780 60 S860 44 900 36" />
              <path className="m" d="M0 262 C90 258 140 240 210 236 S330 214 400 200 S520 190 590 170 S720 140 790 132 S860 120 900 114" /></svg></div>
          </div>
        </div></div>
        <div className="gx-float f1" aria-hidden="true"><small>Just now</small><b>Ravi Kumar</b> completed <b>Vendor follow-up</b></div>
        <div className="gx-float f2" aria-hidden="true"><small>Due today · 17:00</small><b>QA sign-off</b> · Priya Sharma</div>
        <div className="gx-fade" aria-hidden="true" />
      </section>

      {/* 06: what the product actually ships, nothing invented */}
      <section className="gx-facts" aria-label="Taskify in numbers">
        {[['2', 'Roles inside every organization: admin and employee.'], ['5', 'Statuses, including Completed this cycle for recurring work.'],
          ['7', 'Reminder cycles, from once to yearly.'], ['0', 'People outside your organization who can see your work.']].map(([n, t], i) => (
          <div key={n} data-rv style={css({ '--i': i })}><b>{n}</b><span>{t}</span></div>))}
      </section>

      {/* 07 */}
      <section className="gx-final" aria-labelledby="gx-end-h">
        <p className="gx-tag" data-rv><b>07</b> — Your turn</p>
        <h2 id="gx-end-h" aria-label="Assign the first task."><span className="ln" data-rv>Assign the</span><span className="ln i2" data-rv style={css({ '--i': 1 })}><em>first</em> task.</span></h2>
        <div className="gx-stampbig" aria-hidden="true"><small>Due</small>Today</div>
        <div className="gx-end" data-rv><p>Pick a department, a person and a date. Taskify follows it all the way to done.</p>
          <div className="gx-cta">{home}<button type="button" className="gx-b2" onClick={() => rootRef.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' })}><ArrowUp size={15} aria-hidden="true" />Back to the top</button></div></div>
      </section>

      {/* 08 */}
      <footer className="gx-foot">
        <div><span className="gx-logo"><i aria-hidden="true" />Taskify</span><p>Assign work. Track it. Get it done on time.</p></div>
        <div><b>Guide</b>{FEATURES.slice(0, 5).map((f) => <button key={f.id} type="button" onClick={() => { setOpen(f.id); go(f.id); }}>{f.name}</button>)}</div>
        <div><b>More</b>{FEATURES.slice(5).map((f) => <button key={f.id} type="button" onClick={() => { setOpen(f.id); go(f.id); }}>{f.name}</button>)}</div>
        <div><b>Account</b>{standalone ? <><a href="/">Sign in</a><a href="/">Create an organization</a></> : <><Link to="/">Dashboard</Link><Link to="/profile">Profile</Link></>}</div>
      </footer>
    </div>
  );
}
