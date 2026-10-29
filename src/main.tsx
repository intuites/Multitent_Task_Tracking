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
import Frame, { type FrameGroup } from './components/Frame';
import { label } from './lib/ui';

// Route-level code splitting keeps the first load small.
const Clients = lazy(() => import('./pages/Clients'));
const ClientProfile = lazy(() => import('./pages/ClientProfile'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Tasks = lazy(() => import('./pages/Tasks'));
const TaskDetail = lazy(() => import('./pages/TaskDetail'));
const Escalations = lazy(() => import('./pages/Escalations'));
const Employees = lazy(() => import('./pages/Employees'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Reports = lazy(() => import('./pages/Reports'));
const Portal = lazy(() => import('./pages/Portal'));
const Guide = lazy(() => import('./pages/Guide'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const NewOrg = lazy(() => import('./pages/NewOrg'));
const Templates = lazy(() => import('./pages/Templates'));
const misc = (k: 'ActivityLogs' | 'Contacts' | 'Platform') => lazy(() => import('./pages/Misc').then((m) => ({ default: m[k] })));
const ActivityLogs = misc('ActivityLogs'), Contacts = misc('Contacts'), Platform = misc('Platform');
const Settings = lazy(() => import('./pages/OrgSettings'));
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';
import { Boot, PageSkeleton } from './components/Skeleton';

function Shell() {
  const { membership, memberships, switchOrg, session, platformAdmin, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const uid = session!.user.id;
  const [unread, setUnread] = useState(0);
  const [mine, setMine] = useState(0);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const items = navFor(membership?.role);
  const crumb = NAV.find((n) => n.path === pathname || (n.path !== '/' && pathname.startsWith(n.path + '/')))?.label ?? (pathname === '/platform' ? 'Platform' : 'Not found');
  useEffect(() => { document.title = `${crumb} · ${membership?.org_name || 'Taskify'}`; }, [crumb, membership?.org_name]);
  useEffect(() => {
    // select('*') so this works before migration 0010 adds avatar_url
    const load = () => supabase.from('tt_profiles').select('*').eq('user_id', uid).maybeSingle().then(({ data }) => { setName(data?.full_name ?? ''); setAvatar(data?.avatar_url ?? null); });
    load();
    window.addEventListener('tt-profile', load);
    return () => window.removeEventListener('tt-profile', load);
  }, [uid]);

  const refresh = useCallback(() => {
      supabase.from('tt_notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('read_at', null).then(({ count }) => setUnread(count ?? 0));
      supabase.from('tt_tasks').select('id, tt_task_assignees!inner(user_id)', { count: 'exact', head: true }).eq('org_id', membership!.org_id)
        .eq('tt_task_assignees.user_id', uid).is('archived_at', null).not('status', 'in', '(completed,cancelled)').then(({ count }) => setMine(count ?? 0));
  }, [uid, membership]);
  useEffect(() => {
    refresh();
    const h = setInterval(refresh, 60000);
    window.addEventListener('tt-notifications', refresh);
    return () => { clearInterval(h); window.removeEventListener('tt-notifications', refresh); };
  }, [refresh, pathname]);

  const groups: FrameGroup[] = ['Menu', 'CRM', 'Team', 'General'].map((g) => ({
    title: g,
    items: items.filter((n) => n.group === g).map((n) => ({
      label: n.label, icon: n.icon, to: n.path, badge: n.path === '/my-tasks' ? mine : n.path === '/notifications' ? unread : undefined,
    })),
  }));
  if (platformAdmin) groups[3].items.push({ label: 'Platform', icon: Shield, to: '/platform' });

  return (
    <Frame brand={membership?.org_name || 'Taskify'} groups={groups} title={crumb} search={<Search />}
      action={can(membership!.role, 'task:write') ? <Link to="/tasks?new=1" className="pill-btn top-new"><Plus size={16} aria-hidden="true" /><span>New task</span></Link> : undefined}
      bell={{ userId: uid, unread, onChanged: refresh, allTo: '/notifications' }}
      user={{ name: name || session!.user.email!, email: session!.user.email!, role: `${label(membership!.role)} · ${membership!.org_name}`, avatar }}
      orgs={memberships.map((m) => ({ id: m.org_id, name: m.org_name, role: label(m.role) }))} currentOrg={membership!.org_id}
      onSwitchOrg={switchOrg} onCreateOrg={memberships.some((m) => m.role === 'owner') ? () => navigate('/organizations/new') : undefined}
      menu={[
        { label: 'My profile', icon: UserCircle, to: '/profile' },
        { label: 'Notification settings', icon: Bell, to: '/notifications' },
        { label: 'Help & guide', icon: BookOpen, to: '/guide' },
        { label: 'Organization settings', icon: SettingsIcon, to: '/settings' },
      ]}
      onSignOut={signOut} closeKey={pathname}
      footer={(
        <div className="side-card">
          <b>{membership?.org_name}</b>
          <p>You are signed in as {label(membership!.role)}.</p>
          {can(membership!.role, 'members:manage') ? <Link to="/employees" className="pill-btn light">Invite teammates</Link> : <Link to="/profile" className="pill-btn light">Your profile</Link>}
        </div>
      )}>
      <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
    </Frame>
  );
}

const Pending = ({ name }: { name: string }) => <div className="card"><h2>{name}</h2><p>Not available yet.</p></div>;
const Guard = ({ need, children }: { need: Parameters<typeof can>[1]; children: JSX.Element }) => {
  const { membership } = useAuth();
  return can(membership!.role, need) ? children : <Navigate to="/" replace />;
};

function Gate() {
  const { session, membership, portal, platformAdmin, loading, passwordSetup } = useAuth();
  if (!configured) return <div className="card">Set the Supabase variables in <code>.env.local</code>, then restart <code>npm run dev</code>.</div>;
  if (loading) return <Boot />;
  // the product guide is public so people can read it before signing in
  if (!session) return window.location.pathname === '/guide' ? <Suspense fallback={<Boot />}><Guide standalone /></Suspense> : <Login />;
  if (passwordSetup) return <SetPassword />;
  if (portal) return <Suspense fallback={<Boot />}><Portal /></Suspense>;
  if (!membership) return <Onboarding />;
  return (
    <Suspense fallback={<Boot />}>
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<Guard need="client:read"><Clients /></Guard>} />
        <Route path="/clients/:id" element={<Guard need="client:read"><ClientProfile /></Guard>} />
        <Route path="/contacts" element={<Guard need="client:read"><Contacts /></Guard>} />
        <Route path="/projects" element={<Guard need="project:read"><Projects /></Guard>} />
        <Route path="/projects/:id" element={<Guard need="project:read"><ProjectDetail /></Guard>} />
        <Route path="/tasks" element={<Tasks mode="all" />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/my-tasks" element={<Tasks mode="mine" />} />
        <Route path="/team-tasks" element={<Tasks mode="team" />} />
        <Route path="/escalations" element={<Escalations />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/employees" element={<Guard need="task:write"><Employees /></Guard>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/reports" element={<Guard need="report:read"><Reports /></Guard>} />
        <Route path="/activity" element={<Guard need="task:write"><ActivityLogs /></Guard>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/organizations/new" element={<NewOrg />} />
        <Route path="/templates" element={<Guard need="task:write"><Templates /></Guard>} />
        <Route path="/platform" element={platformAdmin ? <Platform /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Pending name="Not found" />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter><AuthProvider><Gate /><DialogHost /><SelectEnhancer /></AuthProvider></BrowserRouter>,
);
