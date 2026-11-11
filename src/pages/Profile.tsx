import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertTriangle, ArrowRightLeft, AtSign, Briefcase, Camera, Building2, CalendarClock, Check, CheckCircle2, Clock, Eye, EyeOff, KeyRound, ListTodo,
  LogOut, Mail, MapPin, Pencil, Phone, ShieldCheck, Trash2, Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { strength } from '../lib/password';
import { useAuth } from '../lib/auth';
import { Badge, fmt, isOverdue, label } from '../lib/ui';
import { ROLE_TEXT } from '../lib/roles';
import { Avatar } from '../components/Frame';
import { CountUp, LiquidBg } from '../components/Liquid';
import { ask } from '../components/Dialog';
import { PageSkeleton } from '../components/Skeleton';
import { MemberEmails } from '../components/MemberEmails';
import MyLook from '../components/MyLook';
import { deletePhotoFile, photoProblem, uploadPhoto } from '../lib/photo';

type Tab = 'overview' | 'work' | 'details' | 'look' | 'security';
const TABS: { id: Tab; name: string }[] = [{ id: 'overview', name: 'Overview' }, { id: 'work', name: 'My work' }, { id: 'details', name: 'Edit details' }, { id: 'look', name: 'Appearance' }, { id: 'security', name: 'Security' }];
const FIELDS = ['full_name', 'job_title', 'department', 'phone', 'location', 'bio'] as const;


export default function Profile() {
  const { session, membership, memberships, switchOrg, signOut, refresh } = useAuth();
  const uid = session!.user.id, orgId = membership!.org_id, role = membership!.role;
  // ?tab=look opens Appearance straight away (the user menu links there)
  const { search } = useLocation();
  const urlTab = TABS.find((t) => t.id === new URLSearchParams(search).get('tab'))?.id;
  const [tab, setTab] = useState<Tab>(urlTab ?? 'overview');
  useEffect(() => { if (urlTab) setTab(urlTab); }, [urlTab]);
  const [p, setP] = useState<any>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pw, setPw] = useState(''), [showPw, setShowPw] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const [pr, mb, tk, tm, tt] = await Promise.all([
      supabase.from('tt_profiles').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('tt_org_members').select('created_at').eq('org_id', orgId).eq('user_id', uid).maybeSingle(),
      supabase.from('tt_tasks').select('id, title, status, priority, due_date, completed_at, tt_task_assignees!inner(user_id)')
        .eq('org_id', orgId).eq('tt_task_assignees.user_id', uid).is('archived_at', null).order('due_date', { nullsFirst: false }).limit(500),
      supabase.from('tt_department_members').select('department_id').eq('org_id', orgId).eq('user_id', uid),
      supabase.from('tt_departments').select('id, name').eq('org_id', orgId),
    ]);
    setP(pr.data ?? { user_id: uid, email: session!.user.email, full_name: '' });
    setJoined(mb.data?.created_at ?? null);
    setTasks(tk.data ?? []);
    const mine = new Set((tm.data ?? []).map((x: any) => x.department_id));
    setTeams((tt.data ?? []).filter((t: any) => mine.has(t.id)).map((t: any) => t.name));
  }, [uid, orgId, session]);
  useEffect(() => { load(); }, [load]);

  if (!p) return <PageSkeleton />;

  const name = p.full_name || session!.user.email!;
  const open = tasks.filter((t) => !['completed', 'completed_cycle'].includes(t.status));
  const done = tasks.filter((t) => ['completed', 'completed_cycle'].includes(t.status));
  const overdue = tasks.filter(isOverdue);
  const weekEnd = Date.now() + 7 * 864e5;
  const dueSoon = open.filter((t) => t.due_date && new Date(t.due_date).getTime() <= weekEnd && !isOverdue(t));
  const rate = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;
  const roleInfo = ROLE_TEXT[role as keyof typeof ROLE_TEXT];

  async function saveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch: Record<string, string | null> = {};
    for (const k of FIELDS) patch[k] = String(f.get(k) ?? '').trim() || null;
    if (!patch.full_name) return setMsg({ kind: 'error', text: 'Enter your full name.' });
    const { error } = await supabase.from('tt_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid);
    if (error) {
      // the extra columns arrive with migration 0009; say so instead of showing a raw schema error
      const missing = /column|schema cache/i.test(error.message);
      return setMsg({ kind: 'error', text: missing ? 'Job title, phone and the other new fields need the database update (migration 0009) before they can be saved. Your name can be saved now.' : error.message });
    }
    setMsg({ kind: 'ok', text: 'Profile saved.' });
    window.dispatchEvent(new Event('tt-profile')); // the top bar shows the new name straight away
    load(); refresh();
  }
  async function saveNameOnly() {
    const el = document.getElementById('pf-full_name') as HTMLInputElement | null;
    const v = el?.value.trim();
    if (!v) return;
    const { error } = await supabase.from('tt_profiles').update({ full_name: v }).eq('user_id', uid);
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'ok', text: 'Name saved.' });
    if (!error) { window.dispatchEvent(new Event('tt-profile')); load(); }
  }
  async function upload(file: File) {
    const bad = photoProblem(file);
    if (bad) return setMsg({ kind: 'error', text: bad });
    setUploading(true);
    let url: string;
    try { url = await uploadPhoto(uid, file); } catch (x) { setUploading(false); return setMsg({ kind: 'error', text: (x as Error).message }); }
    const old = p.avatar_url as string | null;
    const { error } = await supabase.from('tt_profiles').update({ avatar_url: url }).eq('user_id', uid);
    setUploading(false);
    if (error) return setMsg({ kind: 'error', text: error.message });
    await deletePhotoFile(old);
    setMsg({ kind: 'ok', text: 'Photo updated.' });
    window.dispatchEvent(new Event('tt-profile'));
    load();
  }
  async function removePhoto() {
    if (!(await ask({ title: 'Remove profile photo?', message: 'Your initials will show instead.', confirmLabel: 'Remove photo', danger: true })).ok) return;
    const prev = p.avatar_url as string | null;
    const { error } = await supabase.from('tt_profiles').update({ avatar_url: null }).eq('user_id', uid);
    if (error) return setMsg({ kind: 'error', text: error.message });
    await deletePhotoFile(prev);
    setMsg({ kind: 'ok', text: 'Photo removed.' });
    window.dispatchEvent(new Event('tt-profile'));
    load();
  }
  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ kind: 'error', text: 'Use at least 8 characters.' });
    const { error } = await supabase.auth.updateUser({ password: pw });
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'ok', text: 'Password changed. Use it next time you sign in.' });
    if (!error) setPw('');
  }
  async function saveUsername(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get('username') ?? '').trim().toLowerCase();
    if (v && !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(v)) return setMsg({ kind: 'error', text: 'Use 3 to 30 letters, numbers, dots, dashes or underscores, starting with a letter or number.' });
    const { error } = await supabase.from('tt_profiles').update({ username: v || null }).eq('user_id', uid);
    if (error) return setMsg({ kind: 'error', text: error.code === '23505' ? 'That username is taken. Try another.' : /column|schema cache/i.test(error.message) ? 'Usernames need the database update (migration 0035) first.' : error.message });
    setMsg({ kind: 'ok', text: v ? `You can now sign in with ${v}.` : 'Username removed. Sign in with your email.' });
    load();
  }
  async function signOutEverywhere() {
    if (!(await ask({ title: 'Sign out everywhere?', message: 'You will be signed out on every device and browser, including this one.', confirmLabel: 'Sign out everywhere', danger: true })).ok) return;
    await supabase.auth.signOut({ scope: 'global' });
  }
  async function leave() {
    if (!(await ask({ title: `Leave ${membership!.org_name}?`, message: 'You will lose access to its tasks, and be unassigned from your open tasks. An admin will need to invite you again to come back.', confirmLabel: 'Leave organization', danger: true })).ok) return;
    const { error } = await supabase.rpc('tt_leave_org', { p_org: orgId });
    if (error) return setMsg({ kind: 'error', text: /function|schema cache/i.test(error.message) ? 'Leaving needs the database update (migration 0009) first.' : error.message });
    refresh();
  }
  const strong = strength(pw);

  return (
    <div className="pf">
      <header className="card pf-hero">
        <LiquidBg tone="deep" />
        <div className="pf-id">
          <div className="pf-photo">
            <Avatar name={name} url={p.avatar_url} className="pf-avatar" />
            <label className="pf-cam" title="Change photo">
              <Camera size={16} aria-hidden="true" /><span className="sr-only">Upload profile photo</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} disabled={uploading} />
            </label>
            {uploading && <span className="pf-uploading" aria-live="polite">Uploading…</span>}
          </div>
          <div className="pf-name">
            <h2>{name}</h2>
            <p>{[p.job_title, p.department].filter(Boolean).join(' · ') || roleInfo?.title}</p>
            <div className="pf-chips">
              <span className="pf-chip strong"><ShieldCheck size={14} aria-hidden="true" />{label(role)}</span>
              <span className="pf-chip"><Building2 size={14} aria-hidden="true" />{membership!.org_name}</span>
              {p.location && <span className="pf-chip"><MapPin size={14} aria-hidden="true" />{p.location}</span>}
              {joined && <span className="pf-chip"><CalendarClock size={14} aria-hidden="true" />Member since {fmt(joined)}</span>}
            </div>
          </div>
        </div>
        <div className="pf-hero-actions">
          {p.avatar_url && <button type="button" className="pill-btn g-ghost" onClick={removePhoto}><Trash2 size={15} aria-hidden="true" />Remove photo</button>}
          <button type="button" className="pill-btn light pf-edit" onClick={() => setTab('details')}><Pencil size={15} aria-hidden="true" />Edit profile</button>
        </div>
      </header>

      <div className="pf-stats">
        <div className="pf-stat"><span className="rp-ico"><ListTodo size={18} aria-hidden="true" /></span><small>Open tasks</small><b><CountUp value={open.length} /></b></div>
        <div className="pf-stat"><span className="rp-ico warn"><Clock size={18} aria-hidden="true" /></span><small>Due in 7 days</small><b><CountUp value={dueSoon.length} /></b></div>
        <div className="pf-stat"><span className="rp-ico bad"><AlertTriangle size={18} aria-hidden="true" /></span><small>Overdue</small><b><CountUp value={overdue.length} /></b></div>
        <div className="pf-stat"><span className="rp-ico ok"><CheckCircle2 size={18} aria-hidden="true" /></span><small>Completed</small><b><CountUp value={done.length} /></b><em>{rate}% of assigned</em></div>
      </div>

      <div className="rp-tabs" role="tablist" aria-label="Profile sections">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setMsg(null); }}>{t.name}</button>)}
      </div>
      {msg && <p key={msg.text} role={msg.kind === 'error' ? 'alert' : 'status'} className={`auth-msg ${msg.kind}`}>{msg.kind === 'error' ? <AlertTriangle size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}<span>{msg.text}</span></p>}

      <div key={tab} className="pf-panel">
        {tab === 'overview' && (
          <div className="pf-grid even">
              <section className="card" aria-labelledby="about-h">
                <h3 id="about-h">About</h3>
                {p.bio ? <p className="pf-bio">{p.bio}</p> : <p className="muted">Add a short bio so teammates know what you work on.</p>}
                <dl className="facts">
                  <dt><Mail size={14} aria-hidden="true" /> Email</dt><dd>{p.email ?? session!.user.email}</dd>
                  <dt><Phone size={14} aria-hidden="true" /> Phone</dt><dd>{p.phone || '—'}</dd>
                  <dt><Briefcase size={14} aria-hidden="true" /> Title</dt><dd>{p.job_title || '—'}</dd>
                  <dt><Building2 size={14} aria-hidden="true" /> Department</dt><dd>{p.department || '—'}</dd>
                </dl>
              </section>
              <section className="card" aria-labelledby="teams-h">
                <h3 id="teams-h"><Users size={16} aria-hidden="true" /> Departments</h3>
                {teams.length ? <div className="tag-row">{teams.map((t) => <span key={t} className="tag">{t}</span>)}</div> : <p className="muted">You’re not in a department yet.</p>}
              </section>
              {/* every role can move between the organizations it belongs to */}
              <section className="card" aria-labelledby="orgs-h">
                <h3 id="orgs-h"><ArrowRightLeft size={16} aria-hidden="true" /> Your organizations</h3>
                <ul className="people">{memberships.map((m) => (
                  <li key={m.org_id}>
                    <span className="grow"><b>{m.org_name}</b><br /><small className="muted">{m.platform ? 'Platform admin' : label(m.role)}</small></span>
                    {m.org_id === orgId ? <span className="prio prio-low"><Check size={12} aria-hidden="true" />Current</span>
                      : <button type="button" className="pill-btn ghost sm" onClick={() => switchOrg(m.org_id)}>Switch</button>}
                  </li>))}</ul>
                {memberships.length === 1 && <p className="muted pf-hint">When an admin of another organization invites you, it appears here and you can switch between them.</p>}
              </section>
          </div>
        )}

        {tab === 'work' && (
          <section className="card" aria-labelledby="work-h">
            <div className="panel-head"><h3 id="work-h">Assigned to you</h3><Link to="/my-tasks" className="mini-link">Open My Tasks</Link></div>
            {open.length === 0 ? <p className="muted">Nothing open. Nice work.</p> : (
              <ul className="pf-tasks">{open.map((t, i) => (
                <li key={t.id} style={{ '--i': i } as React.CSSProperties}>
                  <Link to={`/tasks/${t.id}`} className="pf-task">
                    <span className={`prio prio-${t.priority}`}>{label(t.priority)}</span>
                    <b>{t.title}</b>
                    <span className={isOverdue(t) ? 'overdue' : 'muted'}>{t.due_date ? `${isOverdue(t) ? 'Overdue · ' : 'Due '}${fmt(t.due_date)}` : 'No due date'}</span>
                    <Badge v={t.status} />
                  </Link>
                </li>))}</ul>)}
            {done.length > 0 && <p className="muted pf-hint">{done.length} completed task{done.length === 1 ? '' : 's'} not shown.</p>}
          </section>
        )}

        {tab === 'details' && (
          <section className="card" aria-labelledby="det-h">
            <h3 id="det-h">Edit details</h3>
            <form className="pf-form" onSubmit={saveDetails}>
              <label>Full name<input id="pf-full_name" name="full_name" defaultValue={p.full_name ?? ''} required maxLength={120} autoComplete="name" /></label>
              <label>Job title<input name="job_title" defaultValue={p.job_title ?? ''} maxLength={120} placeholder="e.g. Project Manager" autoComplete="organization-title" /></label>
              <label>Department<input name="department" defaultValue={p.department ?? ''} maxLength={120} placeholder="e.g. Delivery" /></label>
              <label>Phone<input name="phone" type="tel" defaultValue={p.phone ?? ''} maxLength={40} placeholder="(212) 555-0142" autoComplete="tel" /></label>
              <label>Location<input name="location" defaultValue={p.location ?? ''} maxLength={120} placeholder="New York, NY" /></label>
              <label className="pf-wide">Bio<textarea name="bio" rows={3} defaultValue={p.bio ?? ''} maxLength={1000} placeholder="What you work on, in a sentence or two." /></label>
              <div className="pf-wide pf-actions">
                <button type="submit">Save changes</button>
                {msg?.kind === 'error' && /0009/.test(msg.text) && <button type="button" className="pill-btn ghost" onClick={saveNameOnly}>Save name only</button>}
                <button type="reset" className="link">Undo changes</button>
              </div>
            </form>
          </section>
        )}

        {tab === 'look' && <MyLook />}

        {tab === 'security' && (
          <div className="pf-grid">
            <section className="card" aria-labelledby="pw-h">
              <h3 id="pw-h"><KeyRound size={16} aria-hidden="true" /> Change password</h3>
              <p className="muted">Signed in as {session!.user.email}.</p>
              <form className="stack" onSubmit={changePassword}>
                <span className="pw">
                  <input type={showPw ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" aria-label="New password" minLength={8} required autoComplete="new-password" />
                  <button type="button" className="pw-eye" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}>{showPw ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button>
                </span>
                {pw && <div className={`pw-meter s${strong.score}`} aria-live="polite"><span><i /><i /><i /><i /><i /></span><small>{strong.text}</small></div>}
                <button type="submit">Update password</button>
              </form>
            </section>
            <section className="card" aria-labelledby="un-h">
              <h3 id="un-h"><AtSign size={16} aria-hidden="true" /> Username</h3>
              <p className="muted">Sign in with your username or with {session!.user.email}. Leave empty to sign in with email only.</p>
              <form className="stack" onSubmit={saveUsername} key={p.username ?? ''}>
                <input name="username" defaultValue={p.username ?? ''} placeholder="e.g. priya.s" aria-label="Username" maxLength={30} autoCapitalize="none" spellCheck={false} autoComplete="username" />
                <button type="submit">Save username</button>
              </form>
            </section>
            <section className="card" aria-labelledby="em-h">
              <h3 id="em-h"><Mail size={16} aria-hidden="true" /> Email addresses</h3>
              <p className="muted">Extra addresses in {membership!.org_name} can receive task emails when an admin picks them. You always sign in with the primary.</p>
              <MemberEmails orgId={orgId} userId={uid} primary={session!.user.email!} canEdit />
            </section>
            <div className="pf-col">
              <section className="card" aria-labelledby="ses-h">
                <h3 id="ses-h"><LogOut size={16} aria-hidden="true" /> Sessions</h3>
                <p className="muted">Lost a laptop or used a shared computer? Sign out of every device at once.</p>
                <div className="row filters"><button type="button" className="pill-btn ghost" onClick={signOut}>Log out here</button><button type="button" className="pill-btn ghost danger-text" onClick={signOutEverywhere}>Sign out everywhere</button></div>
              </section>
              {!membership!.platform && <section className="card pf-danger" aria-labelledby="dz-h">
                <h3 id="dz-h"><AlertTriangle size={16} aria-hidden="true" /> Leave organization</h3>
                <p className="muted">Removes your access to {membership!.org_name}. Your completed work stays in the history.</p>
                <button type="button" className="danger" onClick={leave}>Leave {membership!.org_name}</button>
              </section>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
