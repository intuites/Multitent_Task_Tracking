import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { projectProgress } from '../../api/_lib/progress';
import { Badge, fmt, fmtDay, fmtTime, rpc } from '../lib/ui';
import FilePanel from '../components/FilePanel';
import Notifications from './Notifications';
import { Bell, FileText, House, MessageSquarePlus, UserCircle } from 'lucide-react';
import Frame from '../components/Frame';
import { CountUp, LiquidBg } from '../components/Liquid';
import { ListSkeleton } from '../components/Skeleton';

type Tab = 'home' | 'request' | 'documents' | 'notifications' | 'profile';
// internal escalations must not be visible to clients: show them as In Progress
const shown = (s: string) => (s === 'escalation' ? 'in_progress' : s);

function TaskCard({ t, orgId, uid }: { t: any; orgId: string; uid: string }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const c = await       supabase.from('tt_task_comments').select('*').eq('task_id', t.id).eq('visibility', 'client').is('deleted_at', null).order('created_at');
    setComments(c.data ?? []);
  }, [t.id]);
  useEffect(() => { if (open) load(); }, [open, load]);
  async function post(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, body = String(new FormData(form).get('body')).trim();
    const { error } = await supabase.from('tt_task_comments').insert({ org_id: orgId, task_id: t.id, user_id: uid, body, visibility: 'client' });
    if (error) return setError(error.message);
    form.reset(); load();
  }
  return (
    <div className="note">
      <button className="link" onClick={() => setOpen(!open)}>{t.title}</button> <Badge v={shown(t.status)} /> <small>due {fmt(t.due_date)}</small>
      {open && (
        <div>
          {t.description && <p>{t.description}</p>}
          {error && <p role="alert">{error}</p>}
          <h4>Discussion</h4>
          {comments.length === 0 ? <p>No messages yet.</p> : comments.map((c) => <p key={c.id}><b>{c.author_name}</b> <small>{fmtTime(c.created_at)}</small><br />{c.body}</p>)}
          <form className="row filters" onSubmit={post}><input name="body" required placeholder="Write a message" aria-label="Message" /><button type="submit">Send</button></form>
          <h4>Files</h4>
          <FilePanel orgId={orgId} userId={uid} entityType="task" entityId={t.id} canUpload canDelete={false} portal />
        </div>)}
    </div>
  );
}

export default function Portal() {
  const { portal, session, signOut } = useAuth();
  const uid = session!.user.id;
  const [tab, setTab] = useState<Tab>('home');
  const [orgId, setOrgId] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [contact, setContact] = useState<any>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [c, p, t, ms, ct, un] = await Promise.all([
      supabase.from('tt_clients').select('org_id').eq('id', portal!.client_id).maybeSingle(),
      supabase.from('tt_projects').select('id, name, status, due_date, progress_mode, manual_progress').eq('client_id', portal!.client_id),
      supabase.from('tt_tasks').select('id, title, description, status, due_date').eq('client_id', portal!.client_id).order('created_at', { ascending: false }),
      supabase.from('tt_project_milestones').select('project_id, completed_at'),
      supabase.from('tt_client_contacts').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('tt_notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('read_at', null),
    ]);
    setOrgId(c.data?.org_id ?? '');
    // shortcut: 'tasks' progress mode falls back to milestones because the portal cannot read internal tasks; add a server-side figure if clients need it
    setProjects((p.data ?? []).map((x) => ({ ...x, progress: projectProgress(x.progress_mode === 'tasks' ? 'milestones' : x.progress_mode, x.manual_progress, (ms.data ?? []).filter((m) => m.project_id === x.id), []) })));
    setTasks(t.data ?? []); setContact(ct.data); setUnread(un.count ?? 0);
  }, [portal, uid]);
  useEffect(() => {
    load();
    window.addEventListener('tt-notifications', load);
    return () => window.removeEventListener('tt-notifications', load);
  }, [load]);

  async function submitRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    try { await rpc('tt_portal_submit_request', { p_client: portal!.client_id, p_title: f.get('title'), p_description: String(f.get('description')) || null }); form.reset(); setMsg('Request submitted.'); load(); setTab('home'); }
    catch (x) { setMsg((x as Error).message); }
  }

  const go = (t: Tab) => () => { setTab(t); setMsg(''); };
  const items = (list: [Tab, string, typeof House][]) => list.map(([t, l, icon]) => ({ label: l, icon, onClick: go(t), active: tab === t, badge: t === 'notifications' ? unread : undefined }));
  const groups = [
    { title: 'Menu', items: items([['home', 'Home', House], ['request', 'New request', MessageSquarePlus], ['documents', 'Documents', FileText]]) },
    { title: 'General', items: items([['notifications', 'Notifications', Bell], ['profile', 'My profile', UserCircle]]) },
  ];
  const open = tasks.filter((t) => !['completed', 'cancelled'].includes(t.status));
  const next = open.filter((t) => t.due_date && new Date(t.due_date) >= new Date()).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const titles: Record<Tab, string> = { home: 'Home', request: 'New request', documents: 'Documents', notifications: 'Notifications', profile: 'My profile' };
  const first = (contact?.full_name ?? portal!.full_name ?? '').split(' ')[0];

  return (
    <Frame brand={portal!.client_name} groups={groups} title={titles[tab]}
      action={<button type="button" className="pill-btn top-new" onClick={go('request')}><MessageSquarePlus size={16} aria-hidden="true" /><span>New request</span></button>}
      bell={{ userId: uid, unread, onChanged: load, onAll: go('notifications') }}
      user={{ name: contact?.full_name ?? portal!.full_name, email: session!.user.email!, role: `Client · ${portal!.client_name}` }}
      menu={[{ label: 'My profile', icon: UserCircle, onClick: go('profile') }, { label: 'Notification settings', icon: Bell, onClick: go('notifications') }]}
      onSignOut={signOut} closeKey={tab}
      footer={<div className="side-card"><b>Client portal</b><p>You see the projects and tasks your service team shares with {portal!.client_name}.</p></div>}>
      {msg && <p role="status" className="card">{msg}</p>}
      {tab === 'home' && (<>
        <div className="page-head">
          <div><h2 className="page-title">{first ? `Welcome back, ${first}` : 'Welcome back'}</h2><p className="page-sub">Projects and deliverables shared with {portal!.client_name}.</p></div>
          <div className="page-actions"><button className="pill-btn" onClick={go('request')}><MessageSquarePlus size={16} aria-hidden="true" />New request</button></div>
        </div>
        <div className="dash">
          <div className="a-k1 kpi feature"><LiquidBg /><span className="kpi-head"><span>Shared projects</span></span><b><CountUp value={projects.length} /></b><small>{projects.filter((p) => p.status === 'in_progress').length} in progress</small></div>
          <div className="a-k2 kpi"><span className="kpi-head"><span>Open tasks</span></span><b>{open.length}</b><small>Being worked on for you</small></div>
          <div className="a-k3 kpi"><span className="kpi-head"><span>Due this week</span></span><b>{open.filter((t) => t.due_date && new Date(t.due_date).getTime() < Date.now() + 7 * 864e5).length}</b><small>Open tasks due in 7 days</small></div>
          <div className="a-k4 kpi"><span className="kpi-head"><span>Completed</span></span><b>{tasks.filter((t) => t.status === 'completed').length}</b><small>Delivered tasks</small></div>

          <section className="card a-an" aria-labelledby="pp-h">
            <h3 id="pp-h">Project progress</h3>
            {projects.length === 0 ? <p className="muted">No projects have been shared with you yet.</p> : (
              <ul className="progress-list">{projects.map((p) => (
                <li key={p.id}><span className="who"><b>{p.name}</b><small>{p.due_date ? `Due ${fmtDay(p.due_date)}` : 'No due date'}</small></span>
                  <Badge v={p.status} /><span className="meter" role="img" aria-label={`${p.progress}% complete`}><i style={{ width: `${p.progress}%` }} /></span><b className="pct">{p.progress}%</b></li>))}
              </ul>)}
          </section>
          <section className="card a-re" aria-labelledby="nd-h">
            <h3 id="nd-h">Next deadline</h3>
            {next ? (<><p className="remind-title">{next.title}</p><p className="remind-time">Due {fmtTime(next.due_date)}</p></>) : <p className="muted">No upcoming deadlines.</p>}
          </section>
          <section className="card a-pr" aria-labelledby="dc-h">
            <h3 id="dc-h">Documents</h3>
            <p className="muted">Files your team shares with you are under Documents.</p>
            <button type="button" className="pill-btn ghost" onClick={go('documents')}>Open documents</button>
          </section>
          <section className="card a-full" aria-labelledby="td-h">
            <h3 id="td-h">Tasks and deliverables</h3>
            {tasks.length === 0 ? <p className="muted">Nothing shared yet.</p> : tasks.map((t) => <TaskCard key={t.id} t={t} orgId={orgId} uid={uid} />)}
          </section>
        </div>
      </>)}
      {tab === 'request' && (
        <section className="card">
          <h2 className="page-title">New request</h2>
          <p className="page-sub">Tell your service team what you need. It becomes a task they can pick up.</p>
          <form className="grid" onSubmit={submitRequest}>
            <label>What do you need?<input name="title" required maxLength={200} /></label>
            <label>Details<textarea name="description" rows={4} /></label>
            <button type="submit" className="pill-btn">Submit request</button>
          </form>
        </section>)}
      {tab === 'documents' && (
        <section className="card"><h2 className="page-title">Documents</h2>
          {orgId ? <FilePanel orgId={orgId} userId={uid} entityType="client" entityId={portal!.client_id} canUpload={false} canDelete={false} portal /> : <ListSkeleton rows={3} />}
        </section>)}
      {tab === 'notifications' && <Notifications />}
      {tab === 'profile' && contact && (
        <section className="card">
          <h2 className="page-title">My profile</h2>
          <form className="grid" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); try { await rpc('tt_portal_update_contact', { p_phone: f.get('phone'), p_job_title: f.get('job_title') }); setMsg('Saved.'); } catch (x) { setMsg((x as Error).message); } }}>
            <p>{contact.full_name} · {contact.email}</p>
            <label>Phone<input name="phone" defaultValue={contact.phone ?? ''} /></label>
            <label>Job title<input name="job_title" defaultValue={contact.job_title ?? ''} /></label>
            <button type="submit" className="pill-btn">Save</button>
          </form>
        </section>)}
    </Frame>
  );
}
