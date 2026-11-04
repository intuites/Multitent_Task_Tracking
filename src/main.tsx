import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BookOpen, Plus, Settings as SettingsIcon, Shield, UserCircle } from 'lucide-react';
import { AuthProvider, useAuth } from './lib/auth';
import { configured, supabase } from './lib/supabase';
import { navFor, NAV } from './lib/nav';
import { can } from '../api/_lib/permissions';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import SetPassword from './pages/SetPassword';
import Dashboard from './pages/Dashboard';
import Search from './components/Search';
import { DialogHost } from './components/Dialog';
import SelectEnhancer from './components/SelectEnhancer';
import DateEnhancer from './components/DateEnhancer';
import ErrorBoundary, { reloadForNewBuild } from './components/ErrorBoundary';
import Frame, { type FrameGroup } from './components/Frame';
import { ShortcutListener } from './components/Shortcuts';
import { label, NO_ESC } from './lib/ui';
import { startLive, useLive } from './lib/live';

// Route-level code splitting keeps the first load small.
const Tasks = lazy(() => import('./pages/Tasks'));
const TaskDetail = lazy(() => import('./pages/TaskDetail'));
const Employees = lazy(() => import('./pages/Employees'));
const PersonPage = lazy(() => import('./pages/Person'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Reports = lazy(() => import('./pages/Reports'));
const Guide = lazy(() => import('./pages/Guide'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const NewOrg = lazy(() => import('./pages/NewOrg'));
const Templates = lazy(() => import('./pages/Templates'));
const misc = (k: 'ActivityLogs' | 'Platform') => lazy(() => import('./pages/Misc').then((m) => ({ default: m[k] })));
const ActivityLogs = misc('ActivityLogs'), Platform = misc('Platform');
const Settings = lazy(() => import('./pages/OrgSettings'));
const ShortcutsPage = lazy(() => import('./components/Shortcuts'));
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';
import { Boot, PageSkeleton } from './components/Skeleton';

function Shell() {
  const { membership, memberships, switchOrg, session, platformAdmin, signOut, refresh: reloadOrg } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const uid = session!.user.id;
  const [unread, setUnread] = useState(0);
  const [mine, setMine] = useState(0);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const items = navFor(membership?.role);
  const crumb = NAV.find((n) => n.path === pathname || (n.path !== '/' && pathname.startsWith(n.path + '/')))?.label ?? (pathname === '/admin-site' ? 'Admin site' : 'Not found');
  useEffect(() => { document.title = `${crumb} · ${membership?.org_name || 'Taskify'}`; }, [crumb, membership?.org_name]);
  useEffect(() => {
    // select('*') so this works before migration 0010 adds avatar_url
    const load = () => supabase.from('tt_profiles').select('*').eq('user_id', uid).maybeSingle().then(({ data }) => { setName(data?.full_name ?? ''); setAvatar(data?.avatar_url ?? null); });
    load();
    window.addEventListener('tt-profile', load);
    return () => window.removeEventListener('tt-profile', load);
  }, [uid]);

  const refresh = useCallback(() => {
      supabase.from('tt_notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).not('type', 'like', NO_ESC).is('read_at', null).then(({ count }) => setUnread(count ?? 0));
      supabase.from('tt_tasks').select('id, tt_task_assignees!inner(user_id)', { count: 'exact', head: true }).eq('org_id', membership!.org_id)
        .eq('tt_task_assignees.user_id', uid).is('archived_at', null).not('status', 'in', '(completed,completed_cycle)').then(({ count }) => setMine(count ?? 0));
  }, [uid, membership]);
  const orgId = membership!.org_id;
  useEffect(() => startLive(orgId, uid), [orgId, uid]);
  useLive(['tt_notifications', 'tt_tasks', 'tt_task_assignees'], refresh);
  // an admin changed the organization (brand color, name, time zone): re-read it so colors and greeting update for everyone
  useLive(['tt_organizations'], reloadOrg);
  useEffect(() => {
    refresh();
    const h = setInterval(refresh, 60000);
    window.addEventListener('tt-notifications', refresh);
    return () => { clearInterval(h); window.removeEventListener('tt-notifications', refresh); };
  }, [refresh, pathname]);

  const groups: FrameGroup[] = ['Menu', 'Team', 'General'].map((g) => ({
    title: g,
    items: items.filter((n) => n.group === g).map((n) => ({
      label: n.label, icon: n.icon, to: n.path, badge: n.path === '/my-tasks' ? mine : n.path === '/notifications' ? unread : undefined,
    })),
  }));
  if (platformAdmin) groups[2].items.push({ label: 'Admin site', icon: Shield, to: '/admin-site' });

  return (
    <Frame brand={membership?.org_name || 'Taskify'} timeZone={membership?.time_zone} groups={groups} title={crumb} search={<Search />}
      action={can(membership!.role, 'task:write') ? <Link to="/tasks?new=1" className="pill-btn top-new"><Plus size={16} aria-hidden="true" /><span>New task</span></Link> : undefined}
      bell={{ userId: uid, unread, onChanged: refresh, allTo: '/notifications' }}
      user={{ name: name || session!.user.email!, email: session!.user.email!, role: `${membership!.platform ? 'Platform admin' : label(membership!.role)} · ${membership!.org_name}`, avatar }}
      orgs={memberships.map((m) => ({ id: m.org_id, name: m.org_name, role: m.platform ? 'Platform admin' : label(m.role) }))} currentOrg={membership!.org_id}
      onSwitchOrg={switchOrg} onCreateOrg={memberships.some((m) => m.role === 'owner' || m.role === 'admin') ? () => navigate('/organizations/new') : undefined}
      menu={[
        { label: 'My profile', icon: UserCircle, to: '/profile' },
        { label: 'Notification settings', icon: Bell, to: '/notifications' },
        { label: 'Help & guide', icon: BookOpen, to: '/guide' },
        ...(can(membership!.role, 'task:write') ? [{ label: 'Organization settings', icon: SettingsIcon, to: '/settings' }] : []),
      ]}
      onSignOut={signOut} closeKey={pathname}
      footer={(
        <div className="side-card">
          <b>{membership?.org_name}</b>
          <p>You are signed in as {membership!.platform ? 'Platform admin' : label(membership!.role)}.</p>
          {can(membership!.role, 'members:manage') ? <Link to="/employees" className="pill-btn light">Invite teammates</Link> : <Link to="/profile" className="pill-btn light">Your profile</Link>}
        </div>
      )}>
      <ErrorBoundary resetKey={pathname}><Suspense fallback={<PageSkeleton />}><Outlet /></Suspense></ErrorBoundary>
      <ShortcutListener />
    </Frame>
  );
}

const Pending = ({ name }: { name: string }) => <div className="card"><h2>{name}</h2><p>Not available yet.</p></div>;
const Guard = ({ need, to = '/', children }: { need: Parameters<typeof can>[1]; to?: string; children: JSX.Element }) => {
  const { membership } = useAuth();
  return can(membership!.role, need) ? children : <Navigate to={to} replace />;
};

function Gate() {
  const { session, membership, platformAdmin, loading, passwordSetup } = useAuth();
  if (!configured) return <div className="card">Set the Supabase variables in <code>.env.local</code>, then restart <code>npm run dev</code>.</div>;
  if (loading) return <Boot />;
  // the product guide is public so people can read it before signing in
  if (!session) return window.location.pathname === '/guide' ? <Suspense fallback={<Boot />}><Guide standalone /></Suspense> : <Login />;
  if (passwordSetup) return <SetPassword />;
  if (!membership) return <Onboarding />;
  return (
    <Suspense fallback={<Boot />}>
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<Guard need="task:write" to="/my-tasks"><Tasks mode="all" /></Guard>} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/my-tasks" element={<Tasks mode="mine" />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/employees" element={<Guard need="task:write"><Employees /></Guard>} />
        <Route path="/employees/:id" element={<Guard need="task:write"><PersonPage /></Guard>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/reports" element={<Guard need="report:read"><Reports /></Guard>} />
        <Route path="/activity" element={<Guard need="task:write"><ActivityLogs /></Guard>} />
        <Route path="/settings" element={<Guard need="task:write"><Settings /></Guard>} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/shortcuts" element={<ShortcutsPage />} />
        <Route path="/organizations/new" element={<NewOrg />} />
        <Route path="/templates" element={<Guard need="task:write"><Templates /></Guard>} />
        <Route path="/admin-site" element={platformAdmin ? <Platform /> : <Navigate to="/" replace />} />
        <Route path="/platform" element={<Navigate to="/admin-site" replace />} />
        <Route path="*" element={<Pending name="Not found" />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

// Vite fires this when a page's code file from an older deploy can't be fetched; reload once to get the new build
window.addEventListener('vite:preloadError', (e) => { if (reloadForNewBuild()) e.preventDefault(); });

createRoot(document.getElementById('root')!).render(
  <BrowserRouter><AuthProvider><ErrorBoundary><Gate /></ErrorBoundary><DialogHost /><SelectEnhancer /><DateEnhancer /></AuthProvider></BrowserRouter>,
);
