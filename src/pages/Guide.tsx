import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Bell, Building2, CalendarDays, Check, FolderKanban, History, LayoutDashboard, ListChecks,
  Repeat, ShieldCheck, Siren, UserRoundCheck, X, type LucideIcon,
} from 'lucide-react';
import { LiquidBg } from '../components/Liquid';
import { ThemeToggle } from '../components/Frame';
import { MATRIX, type Action } from '../../api/_lib/permissions';
import { ACTION_TEXT, ROLE_TEXT } from '../lib/roles';

interface Feature { id: string; icon: LucideIcon; name: string; line: string; steps: string[]; see: string[]; visual: ReactNode }

const Flow = () => (
  <div className="gv gv-flow" aria-hidden="true">
    {['Not yet started', 'In progress', 'In review', 'Completed'].map((s, i) => <span key={s} className={`gv-step s${i}`} style={{ '--i': i } as React.CSSProperties}>{s}</span>)}
    <span className="gv-side">Blocked · Escalation · Cancelled can happen at any point</span>
  </div>
);
const DashMock = () => (
  <div className="gv gv-dash" aria-hidden="true">
    <div className="gv-kpi feat"><small>Open tasks</small><b>24</b></div><div className="gv-kpi"><small>Overdue</small><b>3</b></div>
    <div className="gv-bars">{[30, 55, 40, 80, 62, 20, 12].map((h, i) => <i key={i} style={{ height: `${h}%`, '--i': i } as React.CSSProperties} />)}</div>
  </div>
);
const EscMock = () => (
  <div className="gv gv-esc" aria-hidden="true">
    <div className="gv-card bad"><Siren size={16} /><b>Critical · Server outage</b><small>Raised 12 min ago · owner Priya</small></div>
    <div className="gv-timeline"><span>Open</span><span>Acknowledged</span><span>Resolved</span></div>
  </div>
);
const ListMock = ({ rows }: { rows: [string, string][] }) => (
  <div className="gv gv-list" aria-hidden="true">{rows.map(([a, b], i) => <div key={a} className="gv-row" style={{ '--i': i } as React.CSSProperties}><b>{a}</b><span>{b}</span></div>)}</div>
);
const CalMock = () => (
  <div className="gv gv-cal" aria-hidden="true">{Array.from({ length: 21 }, (_, i) => <span key={i} className={i === 9 ? 'today' : [4, 12, 17].includes(i) ? 'has' : ''}>{i + 1}</span>)}</div>
);
const ProgressMock = () => (
  <div className="gv gv-progress" aria-hidden="true">
    {[['Website redesign', 72], ['Mobile app', 45], ['Data migration', 90]].map(([n, p], i) => (
      <div key={n} className="gv-prog"><span>{n}</span><span className="gv-track"><i style={{ width: `${p}%`, '--i': i } as React.CSSProperties} /></span><b>{p}%</b></div>))}
  </div>
);

const FEATURES: Feature[] = [
  { id: 'dashboard', icon: LayoutDashboard, name: 'Dashboard', line: 'One screen that shows what needs attention today.',
    steps: ['Sign in and you land here.', 'Open, overdue, due-today and in-review counts update from live data.', 'Click any card to jump straight to that filtered task list.'],
    see: ['Tasks completed per day this week', 'Your next deadline', 'Who is working on what', 'Open escalations at a glance'], visual: <DashMock /> },
  { id: 'tasks', icon: ListChecks, name: 'Tasks and status workflow', line: 'Every task follows the same clear path, and every change is recorded.',
    steps: ['A manager creates a task. It always starts as Not yet started.', 'Assignees move it forward. Only valid next steps are offered.', 'Each change is saved in the task history with who, when and why.'],
    see: ['Checklists with a progress bar', 'Comments, internal or shared with the client', 'Files, dependencies and full history'], visual: <Flow /> },
  { id: 'escalations', icon: Siren, name: 'Escalations', line: 'When something is stuck, raise it so it can’t be missed.',
    steps: ['An owner, admin or manager escalates the task with a reason and severity.', 'The owner of the escalation is notified and the task is marked Escalation.', 'When it’s resolved, the task returns to its previous status.'],
    see: ['Severity and target dates', 'Acknowledge and resolve steps', 'Escalation counts on the dashboard'], visual: <EscMock /> },
  { id: 'projects', icon: FolderKanban, name: 'Projects and milestones', line: 'Group related tasks and track progress toward a deadline.',
    steps: ['Create a project and link it to a client.', 'Add milestones and tasks to it.', 'Progress is calculated from milestones or tasks, or entered by hand.'],
    see: ['Progress bars per project', 'Milestones on the calendar', 'Edit or delete for owners, admins and managers'], visual: <ProgressMock /> },
  { id: 'clients', icon: Building2, name: 'Clients and contacts', line: 'A simple CRM for the companies you do work for.',
    steps: ['Add a client with its status, industry and contact details.', 'Add contacts and keep notes on every conversation.', 'See the client’s projects, tasks, files and activity on one page.'],
    see: ['Lead to active pipeline', 'Contacts with roles', 'Notes and documents'], visual: <ListMock rows={[['Microsoft', 'Active'], ['Contoso', 'Prospect'], ['Northwind', 'Lead']]} /> },
  { id: 'portal', icon: UserRoundCheck, name: 'Client portal', line: 'Clients sign in and see only what you choose to share.',
    steps: ['Give a contact portal access.', 'Mark tasks, projects or files as visible to the client.', 'The client sees progress and can comment, nothing else.'],
    see: ['Shared projects and tasks', 'Client-visible comments', 'Shared documents'], visual: <ListMock rows={[['Website redesign', '72% done'], ['Launch checklist', 'In progress'], ['Brand guide.pdf', 'Shared']]} /> },
  { id: 'calendar', icon: CalendarDays, name: 'Calendar', line: 'Start dates, deadlines, milestones and escalation targets by month.',
    steps: ['Open Calendar from the sidebar.', 'Filter by person, priority or status.', 'Click a day to see its plan in the side panel.'],
    see: ['Today highlighted', 'Colour-coded items', 'What’s coming up this month'], visual: <CalMock /> },
  { id: 'notifications', icon: Bell, name: 'Notifications and reminders', line: 'People hear about work that involves them, in the app and by email.',
    steps: ['Assignments, comments, status changes and escalations create notifications.', 'Due-date reminders and emails are sent by the scheduled job once your admin connects an email provider.', 'Each person chooses what they get in Notification settings.'],
    see: ['Unread badge on the bell', 'Inbox grouped by day', 'Per-type email and in-app switches'], visual: <ListMock rows={[['Assigned to you', 'Design landing page'], ['Due tomorrow', 'QA sign-off'], ['New comment', 'Priya: Looks great!']]} /> },
  { id: 'recurring', icon: Repeat, name: 'Recurring tasks', line: 'Weekly reports and monthly reviews create themselves.',
    steps: ['Set a task to repeat daily, weekly or monthly.', 'The scheduled job creates the next occurrence when it’s due.', 'Each occurrence links back to the original.'],
    see: ['Next run date on the task', 'Occurrence history in Reports'], visual: <ListMock rows={[['Weekly status report', 'Every Monday'], ['Invoice review', 'Monthly · 1st'], ['Backup check', 'Daily']]} /> },
  { id: 'reports', icon: BarChart3, name: 'Reports', line: 'Completion, workload, overdue work and more, ready to export.',
    steps: ['Pick a report from the tabs.', 'Filter by dates, client, project, person, status or priority.', 'Export the result as CSV.'],
    see: ['Completion rate ring', 'Bar charts per person or project', 'Escalation response times'], visual: <DashMock /> },
  { id: 'activity', icon: History, name: 'Activity log and files', line: 'A permanent record of who changed what.',
    steps: ['Every create, edit, status change and delete is logged.', 'Upload files to tasks and clients; share them with the client if needed.', 'Deletes always ask for confirmation first.'],
    see: ['Timeline on every task', 'Organization-wide activity log', 'Private file storage with secure links'], visual: <ListMock rows={[['Status changed', 'In progress → In review'], ['File uploaded', 'Contract.pdf'], ['Task edited', 'Due date moved']]} /> },
];
const ROLES = ['owner', 'admin', 'manager', 'employee'] as const;
const ACTIONS = Object.keys(ACTION_TEXT) as Action[];

export default function Guide({ standalone = false }: { standalone?: boolean }) {
  const [active, setActive] = useState(FEATURES[0].id);
  // highlight the feature currently in view
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    [...FEATURES.map((f) => f.id), 'roles'].forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className={standalone ? 'guide standalone' : 'guide'}>
      {standalone && (
        <header className="g-top">
          <span className="brand"><span className="mark" aria-hidden="true">T</span>Taskify</span>
          <span className="g-top-actions"><ThemeToggle /><a href="/" className="pill-btn">Sign in</a></span>
        </header>
      )}

      <section className="g-hero">
        <LiquidBg tone="deep" />
        <div className="g-hero-copy">
          <p className="g-kicker">Product guide</p>
          <h1>Run client work, tasks and escalations in one calm place.</h1>
          <p className="g-lead">Here’s every part of Taskify, how it works, and what you’ll see on screen.</p>
          <div className="g-cta">
            <button type="button" className="pill-btn light" onClick={() => go(FEATURES[0].id)}>Explore features<ArrowRight size={16} aria-hidden="true" /></button>
            {standalone ? <a href="/" className="pill-btn g-ghost">Sign in</a> : <Link to="/" className="pill-btn g-ghost">Back to dashboard</Link>}
          </div>
        </div>
        <div className="g-hero-art" aria-hidden="true">
          <div className="g-float f1"><span className="dot ev-ms" />Task completed<small>Design landing page</small></div>
          <div className="g-float f2"><span className="dot ev-due" />Due tomorrow<small>QA sign-off</small></div>
          <div className="g-float f3"><span className="dot ev-esc" />Escalation resolved<small>Server outage</small></div>
        </div>
      </section>

      <nav className="g-nav" aria-label="Features">
        {FEATURES.map((f) => (
          <button key={f.id} type="button" className={active === f.id ? 'on' : ''} aria-current={active === f.id ? 'true' : undefined} onClick={() => go(f.id)}>
            <f.icon size={15} aria-hidden="true" />{f.name.split(' and ')[0]}
          </button>
        ))}
        <button type="button" className={active === 'roles' ? 'on' : ''} onClick={() => go('roles')}><ShieldCheck size={15} aria-hidden="true" />Roles</button>
      </nav>

      {FEATURES.map((f, i) => (
        <section key={f.id} id={f.id} className={`g-feature ${i % 2 ? 'flip' : ''}`} aria-labelledby={`${f.id}-h`}>
          <div className="g-text reveal">
            <span className="g-ico"><f.icon size={22} aria-hidden="true" /></span>
            <h2 id={`${f.id}-h`}>{f.name}</h2>
            <p className="g-line">{f.line}</p>
            <h3>How it works</h3>
            <ol className="g-steps">{f.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <h3>What you’ll see</h3>
            <ul className="g-see">{f.see.map((s) => <li key={s}><Check size={15} aria-hidden="true" />{s}</li>)}</ul>
          </div>
          <div className="g-visual reveal">{f.visual}</div>
        </section>
      ))}

      <section id="roles" className="g-roles reveal" aria-labelledby="roles-h">
        <span className="g-ico"><ShieldCheck size={22} aria-hidden="true" /></span>
        <h2 id="roles-h">Roles and permissions</h2>
        <p className="g-line">Everyone gets exactly the access their job needs. The database enforces these rules, not just the screens.</p>
        <div className="g-role-cards">
          {ROLES.map((r) => <div key={r} className="g-role"><b>{ROLE_TEXT[r].title}</b><p>{ROLE_TEXT[r].blurb}</p></div>)}
        </div>
        <div className="g-matrix-wrap">
          <table className="g-matrix">
            <thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r}>{ROLE_TEXT[r].title}</th>)}</tr></thead>
            <tbody>{ACTIONS.map((a) => (
              <tr key={a}><td>{ACTION_TEXT[a]}</td>{ROLES.map((r) => (
                <td key={r}>{MATRIX[r].includes(a)
                  ? <span className="g-yes"><Check size={15} aria-hidden="true" /><span className="sr-only">Yes</span></span>
                  : <span className="g-no"><X size={14} aria-hidden="true" /><span className="sr-only">No</span></span>}</td>))}
              </tr>))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="g-end">
        <LiquidBg />
        <h2>Ready when you are.</h2>
        <p>Everything above is live in your workspace today.</p>
        {standalone ? <a href="/" className="pill-btn light">Sign in to Taskify</a> : <Link to="/" className="pill-btn light">Go to dashboard</Link>}
      </section>
    </div>
  );
}
