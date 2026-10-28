import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { reducedMotion } from './Liquid';
import { Bell, CheckCheck, ChevronDown, LogOut, Menu, X, type LucideIcon } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Shared app frame (sidebar + top bar) for the staff app and the client portal.
export interface FrameItem { label: string; icon: LucideIcon; to?: string; onClick?: () => void; active?: boolean; badge?: number }
export interface FrameGroup { title: string; items: FrameItem[] }
export interface BellProps { userId: string; unread: number; onChanged: () => void; allTo?: string; onAll?: () => void }

export const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// Greeting and date follow New York time; Intl switches EST/EDT on its own, so daylight saving needs no code.
const TZ = 'America/New_York';
const nyHour = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d));
const greeting = (d: Date) => { const h = nyHour(d); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

// close a popover on outside click or Escape
function useDismiss(ref: RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, close, ref]);
}

// Active-page marker that flows between sidebar items: it first stretches across the old and new item,
// then contracts onto the new one with a spring, so it reads as a droplet moving rather than a jump.
function useLiquidMarker(navRef: RefObject<HTMLElement>, key: string) {
  const [pos, setPos] = useState({ top: 0, height: 0, on: false, phase: 'settle' as 'stretch' | 'settle' });
  const prev = useRef<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('.side-link.active');
    if (!el) { prev.current = null; setPos((p) => ({ ...p, on: false })); return; }
    const next = { top: el.offsetTop + 8, height: el.offsetHeight - 16 };
    const p = prev.current;
    prev.current = next;
    if (!p || p.top === next.top || reducedMotion()) { setPos({ ...next, on: true, phase: 'settle' }); return; }
    const top = Math.min(p.top, next.top);
    setPos({ top, height: Math.max(p.top + p.height, next.top + next.height) - top, on: true, phase: 'stretch' });
    const t = setTimeout(() => setPos({ ...next, on: true, phase: 'settle' }), 160);
    return () => clearTimeout(t);
  }, [key, navRef]);
  return pos;
}

// Soft light that follows the pointer on buttons and stat cards (CSS reads --mx / --my).
function usePointerLight() {
  useEffect(() => {
    if (reducedMotion()) return;
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('.pill-btn, .kpi, button[type=submit]') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => document.removeEventListener('pointermove', move);
  }, []);
}

function Item({ i }: { i: FrameItem }) {
  const body = (<><i.icon size={18} aria-hidden="true" /><span>{i.label}</span>{!!i.badge && <span className="count">{i.badge > 99 ? '99+' : i.badge}</span>}</>);
  if (i.to) return <NavLink to={i.to} end={i.to === '/'} className="side-link">{body}</NavLink>;
  return <button type="button" className={i.active ? 'side-link active' : 'side-link'} aria-current={i.active ? 'page' : undefined} onClick={i.onClick}>{body}</button>;
}

function NotificationBell({ userId, unread, onChanged, allTo, onAll }: BellProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const close = () => setOpen(false);
  useDismiss(ref, open, close);

  const load = () => supabase.from('tt_notifications').select('id, title, body, link, read_at, created_at').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(6).then(({ data }) => setRows(data ?? []));
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function markAll() {
    await supabase.from('tt_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null);
    load(); onChanged(); window.dispatchEvent(new Event('tt-notifications'));
  }
  async function openOne(n: any) {
    if (!n.read_at) { await supabase.from('tt_notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); onChanged(); window.dispatchEvent(new Event('tt-notifications')); }
    close();
    if (n.link) navigate(n.link);
  }
  const viewAll = () => { close(); if (onAll) onAll(); else if (allTo) navigate(allTo); };

  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className="icon-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
        <span className="sr-only">Notifications{unread ? `, ${unread} unread` : ''}</span>
      </button>
      {open && (
        <div className="pop notif-pop" role="dialog" aria-label="Notifications">
          <div className="pop-head"><b>Notifications</b>{unread > 0 && <button type="button" className="link" onClick={markAll}><CheckCheck size={15} aria-hidden="true" /> Mark all read</button>}</div>
          {rows === null ? <p className="pop-empty">Loading…</p> : rows.length === 0 ? <p className="pop-empty">You're all caught up.</p> : (
            <ul className="notif-list">{rows.map((n) => (
              <li key={n.id}><button type="button" className={n.read_at ? 'notif' : 'notif new'} onClick={() => openOne(n)}>
                <span className="notif-title">{n.title}</span>
                {n.body && <span className="notif-body">{n.body}</span>}
                <span className="notif-time">{ago(n.created_at)}</span>
              </button></li>))}
            </ul>)}
          <button type="button" className="pop-foot" onClick={viewAll}>View all notifications</button>
        </div>
      )}
    </div>
  );
}

export interface MenuEntry { label: string; icon: LucideIcon; to?: string; onClick?: () => void }

function ProfileMenu({ user, menu, onSignOut }: { user: { name: string; email: string; role?: string }; menu: MenuEntry[]; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(ref, open, close);
  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className="me" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
        <span className="me-text"><b>{user.name}</b><small>{user.role ?? user.email}</small></span>
        <ChevronDown size={16} className="me-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="pop menu-pop" role="menu">
          <div className="pop-id"><b>{user.name}</b><small>{user.email}</small></div>
          {menu.map((m) => m.to
            ? <Link key={m.label} role="menuitem" to={m.to} className="menu-item" onClick={close}><m.icon size={16} aria-hidden="true" />{m.label}</Link>
            : <button key={m.label} role="menuitem" type="button" className="menu-item" onClick={() => { close(); m.onClick?.(); }}><m.icon size={16} aria-hidden="true" />{m.label}</button>)}
          <button role="menuitem" type="button" className="menu-item danger-text" onClick={onSignOut}><LogOut size={16} aria-hidden="true" />Log out</button>
        </div>
      )}
    </div>
  );
}

export default function Frame({ brand, groups, footer, title, search, action, bell, user, menu, onSignOut, closeKey, children }: {
  brand: string; groups: FrameGroup[]; footer?: ReactNode; title: string; search?: ReactNode; action?: ReactNode; bell: BellProps;
  user: { name: string; email: string; role?: string }; menu: MenuEntry[]; onSignOut: () => void; closeKey: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [closeKey]);
  const navRef = useRef<HTMLElement>(null);
  const marker = useLiquidMarker(navRef, closeKey);
  usePointerLight();
  const first = user.name.includes('@') ? '' : user.name.split(' ')[0];
  // re-render each minute so the greeting rolls over (morning → afternoon) without a reload
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const today = now.toLocaleDateString(undefined, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="app">
      <aside id="side" className={open ? 'side open' : 'side'}>
        <div className="brand"><span className="mark" aria-hidden="true">{initials(brand).charAt(0)}</span><span>{brand}</span></div>
        <nav aria-label="Main" ref={navRef}>
          <span className={`side-flow ${marker.phase}`} aria-hidden="true"
            style={{ transform: `translateY(${marker.top}px)`, height: marker.height, opacity: marker.on ? 1 : 0 }} />
          {groups.filter((g) => g.items.length).map((g) => (
            <div key={g.title} className="side-group">
              <p className="side-title">{g.title}</p>
              {g.items.map((i) => <Item key={i.label} i={i} />)}
            </div>
          ))}
          <button type="button" className="side-link" onClick={onSignOut}><LogOut size={18} aria-hidden="true" /><span>Log out</span></button>
        </nav>
        {footer}
      </aside>
      <div className="stage">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-expanded={open} aria-controls="side" onClick={() => setOpen(!open)}>
            {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}<span className="sr-only">Menu</span>
          </button>
          <h1 className="sr-only">{title}</h1>
          <div className="hello"><b>{greeting(now)}{first && `, ${first}`}</b><small>{today}</small></div>
          {search ?? <span className="grow" />}
          <div className="top-actions">
            {action}
            <NotificationBell {...bell} />
            <span className="top-divider" aria-hidden="true" />
            <ProfileMenu user={user} menu={menu} onSignOut={onSignOut} />
          </div>
        </header>
        <main className="content"><div className="page" key={closeKey}>{children}</div></main>
      </div>
    </div>
  );
}
