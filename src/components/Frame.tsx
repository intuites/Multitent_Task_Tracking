import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Bell, CheckCheck, ChevronDown, LogOut, Menu, X, type LucideIcon } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Shared app frame (sidebar + top bar) for the staff app and the client portal.
export interface FrameItem { label: string; icon: LucideIcon; to?: string; onClick?: () => void; active?: boolean; badge?: number }
export interface FrameGroup { title: string; items: FrameItem[] }
export interface BellProps { userId: string; unread: number; onChanged: () => void; allTo?: string; onAll?: () => void }

export const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
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
    load(); onChanged();
  }
  async function openOne(n: any) {
    if (!n.read_at) { await supabase.from('tt_notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); onChanged(); }
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
  const first = user.name.includes('@') ? '' : user.name.split(' ')[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="app">
      <aside id="side" className={open ? 'side open' : 'side'}>
        <div className="brand"><span className="mark" aria-hidden="true">{initials(brand).charAt(0)}</span><span>{brand}</span></div>
        <nav aria-label="Main">
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
          <div className="hello"><b>{greeting()}{first && `, ${first}`}</b><small>{today}</small></div>
          {search ?? <span className="grow" />}
          <div className="top-actions">
            {action}
            <NotificationBell {...bell} />
            <span className="top-divider" aria-hidden="true" />
            <ProfileMenu user={user} menu={menu} onSignOut={onSignOut} />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
