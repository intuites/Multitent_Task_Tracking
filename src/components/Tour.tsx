import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Bell, Building2, CheckCircle2, LayoutDashboard, ListChecks, ListTodo, Moon, PanelLeftClose, Plus, Search, Settings, UserCircle, type LucideIcon } from 'lucide-react';

/** A step points at an element on screen (first visible match of `sel`) or, without `sel`, sits in the middle. */
interface Step { sel?: string; icon: LucideIcon; title: string; body: string; admin?: boolean }
const EVT = 'tt-tour';
/** Replays the tour (profile menu → Take the tour). */
export const startTour = () => window.dispatchEvent(new Event(EVT));

const steps = (first: string, phone: boolean): Step[] => [
  { icon: CheckCircle2, title: `Welcome to Taskify${first ? `, ${first}` : ''}`, body: 'Here is a one-minute look at where everything is. You can skip it and replay it later from your profile menu.' },
  phone
    ? { sel: '.menu-btn', icon: PanelLeftClose, title: 'Open the menu', body: 'Tap here to open the sidebar with every page. Tap outside it to close it again.' }
    : { sel: '.side-toggle', icon: PanelLeftClose, title: 'Expand or collapse the sidebar', body: 'Switch the sidebar between full names and icons only, to give your work more room. Shortcut: Ctrl+B.' },
  { sel: '.org-btn', icon: Building2, title: 'Your organization', body: 'Everything you see belongs to this organization. Click it to switch to another one you are a member of.' },
  { sel: 'a.side-link[href="/"]', icon: LayoutDashboard, title: 'Dashboard', body: 'Your open, overdue and due-today work at a glance, with progress for the whole team.' },
  { sel: 'a.side-link[href="/my-tasks"]', icon: ListTodo, title: 'My Tasks', body: 'Everything assigned to you. Open a task to update its status, leave a comment or read its history.' },
  { sel: '.top-new', icon: Plus, title: 'Create a task', admin: true, body: 'Pick the department and person, set a priority, a due date and a reminder. Add sub-tasks, a lead and a manager if you need them.' },
  { sel: 'a.side-link[href="/tasks"]', icon: ListChecks, title: 'All tasks', admin: true, body: 'Every task in the organization, with filters by status, person and department.' },
  { sel: '.search', icon: Search, title: 'Search', body: 'Find any task or person from anywhere. Press Ctrl+K to jump straight here.' },
  { sel: '[data-tour="bell"]', icon: Bell, title: 'Notifications', body: 'New assignments, status changes and comments show up here the moment they happen. Emails follow your notification settings.' },
  { sel: '.theme-btn', icon: Moon, title: 'Light or dark', body: 'Switch between light and dark mode. Your organization’s brand color is used in both.' },
  { sel: '.me', icon: UserCircle, title: 'Your profile', body: 'Change your name and photo, choose which notifications you get, open the guide, or log out.' },
  { sel: 'a.side-link[href="/settings"]', icon: Settings, title: 'Organization settings', admin: true, body: 'Brand color, time zone and digest emails for everyone in the organization.' },
  { icon: CheckCircle2, title: 'You’re all set', body: 'Replay this tour any time from your profile menu → Take the tour.' },
];

const visible = (sel?: string) => {
  if (!sel) return null;
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
};

export default function Tour({ uid, name, admin }: { uid: string; name: string; admin: boolean }) {
  const key = `tt-tour-done:${uid}`;
  const [list, setList] = useState<Step[] | null>(null);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const first = name.includes('@') ? '' : name.split(' ')[0];

  const open = useCallback(() => {
    // only steps whose element is on screen for this person (admins see more; phones have no sidebar toggle)
    const all = steps(first, !visible('.side-toggle'));
    setList(all.filter((s) => (!s.admin || admin) && (!s.sel || visible(s.sel))));
    setI(0);
  }, [first, admin]);
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
  const [ch, setCh] = useState(220);
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
  const W = Math.min(360, innerWidth - 32);
  const pos = spot ? (() => {
    const below = spot.top + spot.height + 14, h = ch;
    const top = below + h < innerHeight - 16 ? below : Math.max(16, spot.top - h - 14);
    const left = Math.min(Math.max(16, spot.left + spot.width / 2 - W / 2), innerWidth - W - 16);
    return { top, left, width: W };
  })() : { top: '50%', left: '50%', width: W, transform: 'translate(-50%, -50%)' };
  const Icon = step.icon;

  return createPortal(
    <div className="tour" aria-live="polite">
      <div className="tour-block" onClick={(e) => e.stopPropagation()} />
      <div className={`tour-spot${spot ? '' : ' center'}`} style={spot ?? undefined} aria-hidden="true" />
      <div ref={card} key={i} className={`tour-card${spot ? '' : ' center'}`} style={pos as React.CSSProperties}
        role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b" tabIndex={-1}>
        <div className="tour-head">
          <span className="tour-ico"><Icon size={18} aria-hidden="true" /></span>
          <small className="muted">Step {i + 1} of {list.length}</small>
          <button type="button" className="link tour-skip" onClick={done}>{last ? 'Close' : 'Skip tour'}</button>
        </div>
        <h2 id="tour-t">{step.title}</h2>
        <p id="tour-b">{step.body}</p>
        <div className="tour-foot">
          <span className="tour-dots" aria-hidden="true">{list.map((_, n) => <i key={n} className={n === i ? 'on' : n < i ? 'past' : ''} />)}</span>
          {i > 0 && <button type="button" className="pill-btn ghost" onClick={() => setI(i - 1)}><ArrowLeft size={15} aria-hidden="true" />Back</button>}
          <button type="button" className="pill-btn" onClick={() => (last ? done() : setI(i + 1))}>{last ? 'Start working' : i === 0 ? 'Show me around' : 'Next'}{!last && <ArrowRight size={15} aria-hidden="true" />}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
