import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, ArrowRight, BarChart3, Bell, Building2, CalendarDays, Check, CheckCircle2, LayoutDashboard, ListChecks, ListTodo,
  MessageSquare, Moon, PanelLeftClose, Plus, Rocket, Search, Settings, Sparkles, UserCircle, Users, type LucideIcon,
} from 'lucide-react';
import { LiquidBg } from './Liquid';

interface Feature { icon: LucideIcon; name: string; text: string }
/** A step points at an element on screen (first visible match of `sel`) or, without `sel`, sits in the middle. */
interface Step { sel?: string; icon: LucideIcon; group: string; title: string; body: string; tips?: string[]; features?: Feature[] }
const EVT = 'tt-tour';
/** Replays the tour (profile menu → Take the tour). */
export const startTour = () => window.dispatchEvent(new Event(EVT));

function steps(o: { first: string; org: string; admin: boolean; phone: boolean }): Step[] {
  const { first, org, admin, phone } = o;
  const hi = `Welcome to Taskify${first ? `, ${first}` : ''}`;
  const welcome: Step = admin
    ? { icon: Sparkles, group: 'Welcome', title: hi, body: `You are an admin of ${org}. Here is what you can do. The tour takes about a minute.`, features: [
        { icon: Plus, name: 'Create and assign', text: 'Tasks for any department or person' },
        { icon: Users, name: 'People and departments', text: 'Invite, set roles, group teams' },
        { icon: BarChart3, name: 'Reports', text: 'Progress, overdue work, exports' },
        { icon: Settings, name: 'Organization', text: 'Brand color, time zone, digests' },
      ] }
    : { icon: Sparkles, group: 'Welcome', title: hi, body: `You are part of ${org}. Here is how your work flows through Taskify. The tour takes about a minute.`, features: [
        { icon: ListTodo, name: 'Your tasks', text: 'Everything assigned to you' },
        { icon: CheckCircle2, name: 'Update status', text: 'Started, pending, completed' },
        { icon: MessageSquare, name: 'Comment', text: 'Ask questions on the task itself' },
        { icon: Bell, name: 'Reminders', text: 'In the app and by email' },
      ] };
  const all: (Step | false)[] = [
    welcome,
    phone
      ? { sel: '.menu-btn', icon: PanelLeftClose, group: 'Navigation', title: 'Open the menu', body: 'Tap here for every page. Tap outside the menu to close it.' }
      : { sel: '.side-toggle', icon: PanelLeftClose, group: 'Navigation', title: 'Expand or collapse the sidebar', body: 'Show the sidebar with names, or as icons only to give your work more room.', tips: ['Shortcut: Ctrl+B'] },
    { sel: '.org-btn', icon: Building2, group: 'Navigation', title: 'Your organization', body: 'Everything on screen belongs to this organization. Click it to switch if you are in more than one.' },
    { sel: 'a.side-link[href="/"]', icon: LayoutDashboard, group: 'Your work', title: 'Dashboard', body: admin ? 'The state of the whole team at a glance.' : 'Your day at a glance.',
      tips: admin ? ['Open, overdue and due-today work', 'Who is working on what right now'] : ['Your open, overdue and due-today tasks', 'Your next deadline'] },
    { sel: 'a.side-link[href="/my-tasks"]', icon: ListTodo, group: 'Your work', title: 'My Tasks', body: 'Everything assigned to you, newest first.',
      tips: ['Open a task, then Update status', 'Add a reason so everyone knows why', 'Comments keep the conversation on the task'] },
    admin && { sel: '.top-new', icon: Plus, group: 'Your work', title: 'Create a task', body: 'Start any task from here, on any page.',
      tips: ['Department, then person, then priority', 'Due date and a repeating reminder', 'Optional sub-tasks, lead and manager'] },
    admin && { sel: 'a.side-link[href="/tasks"]', icon: ListChecks, group: 'Your work', title: 'All tasks', body: 'Every task in the organization in one list.', tips: ['Filter by status, person and department'] },
    !admin && { sel: 'a.side-link[href="/calendar"]', icon: CalendarDays, group: 'Your work', title: 'Calendar', body: 'Your due dates laid out by day, week and month.' },
    admin && { sel: 'a.side-link[href="/employees"]', icon: Users, group: 'Your team', title: 'Employees and departments', body: 'Invite people, choose admin or employee, and group them into departments so tasks reach the right person.' },
    admin && { sel: 'a.side-link[href="/reports"]', icon: BarChart3, group: 'Your team', title: 'Reports', body: 'Completed, overdue and workload numbers for any period, ready to download.' },
    { sel: '.search', icon: Search, group: 'Stay informed', title: 'Search', body: 'Find any task or person from anywhere.', tips: ['Shortcut: Ctrl+K'] },
    { sel: '[data-tour="bell"]', icon: Bell, group: 'Stay informed', title: 'Notifications', body: 'New assignments, status changes and comments arrive here the moment they happen, and by email if you want them.' },
    { sel: '.theme-btn', icon: Moon, group: 'Make it yours', title: 'Light or dark', body: `Switch themes any time. ${org}’s brand color is used in both.` },
    { sel: '.me', icon: UserCircle, group: 'Make it yours', title: 'Your profile', body: 'Your name and photo, which notifications you get, the guide, and log out.' },
    admin && { sel: 'a.side-link[href="/settings"]', icon: Settings, group: 'Make it yours', title: 'Organization settings', body: 'The brand color everyone sees, the time zone reminders run on, and the daily digest emails.' },
    { icon: Rocket, group: 'Done', title: 'You’re all set', body: admin ? 'A good first step: create a task and assign it to someone.' : 'A good first step: open My Tasks and update the status of one task.',
      tips: ['Replay this tour from your profile menu → Take the tour'] },
  ];
  return all.filter(Boolean) as Step[];
}

const visible = (sel?: string) => {
  if (!sel) return null;
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
};

export default function Tour({ uid, name, org, admin }: { uid: string; name: string; org: string; admin: boolean }) {
  const key = `tt-tour-done:${uid}`;
  const [list, setList] = useState<Step[] | null>(null);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [ch, setCh] = useState(240);
  const card = useRef<HTMLDivElement>(null);
  const first = name.includes('@') ? '' : name.split(' ')[0];

  const open = useCallback(() => {
    // only steps whose element is on screen for this person (phones have no sidebar toggle, and the sidebar is closed)
    setList(steps({ first, org, admin, phone: !visible('.side-toggle') }).filter((s) => !s.sel || visible(s.sel)));
    setI(0);
  }, [first, org, admin]);
  const done = useCallback(() => { setList(null); try { localStorage.setItem(key, '1'); } catch { /* private window: shows again next time */ } }, [key]);

  // first visit on this device: start once the page has settled
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(key) === '1'; } catch { seen = true; }
    const t = seen ? 0 : window.setTimeout(open, 900);
    window.addEventListener(EVT, open);
    return () => { clearTimeout(t); window.removeEventListener(EVT, open); };
  }, [key, open]);

  const step = list?.[i];
  // follow the target as the page scrolls or resizes
  useLayoutEffect(() => {
    if (!step) return;
    const el = visible(step.sel);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const measure = () => setBox(el ? el.getBoundingClientRect() : null);
    measure();
    addEventListener('resize', measure); addEventListener('scroll', measure, true);
    return () => { removeEventListener('resize', measure); removeEventListener('scroll', measure, true); };
  }, [step]);
  useLayoutEffect(() => { if (card.current) setCh(card.current.offsetHeight); card.current?.focus(); }, [i, list]);

  useEffect(() => {
    if (!list) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, list.length - 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [list, done]);

  if (!list || !step) return null;
  const last = i === list.length - 1, pad = 8;
  const spot = box && { left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
  // the card sits under the target, or above it when there is no room, kept inside the window
  const W = Math.min(step.features ? 480 : 392, innerWidth - 24);
  const pos = spot ? (() => {
    const below = spot.top + spot.height + 16;
    const top = below + ch < innerHeight - 12 ? below : Math.max(12, spot.top - ch - 16);
    const left = Math.min(Math.max(12, spot.left + spot.width / 2 - W / 2), innerWidth - W - 12);
    return { top, left, width: W };
  })() : { top: '50%', left: '50%', width: W, transform: 'translate(-50%, -50%)' };
  const Icon = step.icon;

  return createPortal(
    <div className="tour">
      <div className="tour-block" />
      <div className={`tour-spot${spot ? '' : ' center'}`} style={spot ?? undefined} aria-hidden="true"><i /><i /></div>
      <div ref={card} key={i} className={`tour-card${spot ? '' : ' center'}`} style={pos as React.CSSProperties}
        role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b" tabIndex={-1}>
        <header className="tour-hero">
          <LiquidBg tone="deep" />
          <div className="tour-hero-row">
            <span className="tour-ico"><Icon size={20} aria-hidden="true" /></span>
            <span className="tour-meta"><span className="tour-group">{step.group}</span><small>{i + 1} of {list.length}</small></span>
            <button type="button" className="tour-skip" onClick={done}>{last ? 'Close' : 'Skip'}</button>
          </div>
          <h2 id="tour-t">{step.title}</h2>
        </header>
        <div className="tour-body">
          <p id="tour-b">{step.body}</p>
          {step.features && <ul className="tour-feats">{step.features.map((f, n) => (
            <li key={f.name} style={{ '--n': n } as React.CSSProperties}><span><f.icon size={17} aria-hidden="true" /></span><b>{f.name}</b><small>{f.text}</small></li>))}</ul>}
          {step.tips && <ul className="tour-tips">{step.tips.map((t) => <li key={t}><Check size={15} aria-hidden="true" />{t}</li>)}</ul>}
        </div>
        <footer className="tour-foot">
          <span className="tour-progress" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={list.length} aria-valuenow={i + 1}>
            <i style={{ transform: `scaleX(${(i + 1) / list.length})` }} /></span>
          <span className="tour-actions">
            {i > 0 && <button type="button" className="pill-btn ghost" onClick={() => setI(i - 1)}><ArrowLeft size={15} aria-hidden="true" />Back</button>}
            <button type="button" className="pill-btn" onClick={() => (last ? done() : setI(i + 1))}>
              {last ? 'Start working' : i === 0 ? 'Show me around' : 'Next'}{!last && <ArrowRight size={15} aria-hidden="true" />}</button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
