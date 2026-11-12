import type { ReactNode } from 'react';
import { Bell, Check as CheckIco, ChevronDown, Lock, Plus, X } from 'lucide-react';
import { Stage, Window, Bar, Text, type Act, type Rect } from '../stageshow/kit';
import { Avatar, Check, Facepile, Menu, Spinner, Toast } from '../stageshow/kit/parts';
import { Badge, Button, Segmented, Toggle } from '../stageshow/kit/controls';
import { Collapse, Count, Popover, Roll, States, Swap } from '../stageshow/kit/motion';
import { Chart } from '../stageshow/kit/chart';
import { useTheme } from '../lib/theme';
import './guideHeroDemo.css';
import './guideDemos.css';

// One short stageshow loop per Guide feature. Each is a Taskify window in which one thing happens,
// with a cause for every change and a reset the viewer sees.

const W = 460, H = 340;
const below = (r: Rect, gap = 6) => ({ left: r.x, top: r.y + r.height + gap });

function Shell<S extends object>({ initial, poster, script, title, children }: {
  initial: S; poster: S; script: (a: Act<S>) => Promise<void>; title: string;
  children: (s: S, rect: (n: string) => Rect) => ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <Stage width={W} height={H} initial={initial} poster={poster} script={script} fill cursor={{ at: { x: 400, y: 300 } }}
      theme={theme === 'dark' ? 'dark' : 'light'} className="tk-demo tk-feat">
      {(s, rect) => (
        <>
          <Window className="tf-win" title={title}><div className="tf-body">{children(s, rect)}</div></Window>
          <span data-target="rest" style={{ position: 'absolute', left: 400, top: 300 }} />
        </>
      )}
    </Stage>
  );
}

const pick = async <S extends object>(a: Act<S>, open: string, menu: Partial<S>, item: string, done: Partial<S>, close: Partial<S>) => {
  await a.click(open); await a.set(menu); await a.wait(450);
  await a.move(item); await a.wait(200); await a.click();
  await a.set(done); await a.set(close);
};

/* ───────── Organizations: switching organization changes everything you can see */
const ORGS = [
  { name: 'Acme Corp', tasks: ['Q4 budget review', 'Vendor contracts'] },
  { name: 'Northwind', tasks: ['Warehouse audit', 'Fleet renewals'] },
  { name: 'Globex', tasks: ['Hiring plan', 'Office move'] },
];
type OrgS = { menu: boolean; org: number };
export function OrgDemo() {
  const script = async (a: Act<OrgS>) => {
    for (const next of [1, 2, 0]) {
      await a.wait(next === 1 ? 900 : 2200);
      await pick(a, 'org', { menu: true }, `o-${next}`, { org: next }, { menu: false });
      await a.move('rest');
    }
    await a.wait(1400);
  };
  return (
    <Shell<OrgS> title="Taskify" initial={{ menu: false, org: 0 }} poster={{ menu: false, org: 1 }} script={script}>
      {(s, rect) => (
        <>
          <div className="tf-head">
            <Button data-target="org" data-open={s.menu || undefined} trailingIcon={<ChevronDown size={14} />}>
              <Swap id={s.org}><span className="tf-org"><Avatar name={ORGS[s.org].name} size={18} tone="accent" />{ORGS[s.org].name}</span></Swap>
            </Button>
            <span className="tf-lock"><Lock size={13} /><Swap id={s.org}>{`Only ${ORGS[s.org].name} members see this`}</Swap></span>
          </div>
          <Swap id={s.org} className="tf-rows">
            <div className="tf-rows">
              {ORGS[s.org].tasks.map((t, i) => (
                <div key={t} className="tf-row"><Text className="tf-t">{t}</Text><Avatar name={['Priya Shah', 'Arjun Mehta'][i]} size={22} /><Badge tone={i ? 'neutral' : 'warning'}>{i ? 'Not yet started' : 'Started'}</Badge></div>
              ))}
              {[120, 96].map((w) => <div key={w} className="tf-row"><Bar w={w} h={7} tone={3} /><Avatar plain size={22} /><Bar w={70} h={20} r={6} tone={1} /></div>)}
            </div>
          </Swap>
          <Popover show={s.menu} className="tf-pop" style={{ ...below(rect('org')), width: 200 }}>
            <Menu items={ORGS.map((o) => <span className="tf-org"><Avatar name={o.name} size={18} tone="accent" />{o.name}</span>)} targets={['o-0', 'o-1', 'o-2']} value={s.org} />
          </Popover>
        </>
      )}
    </Shell>
  );
}

/* ───────── Departments: add a member to a department */
const FIN = ['Priya Shah', 'Arjun Mehta', 'Kiran Das', 'Meera Iyer'];
type DeptS = { menu: boolean; added: boolean; toast: boolean };
export function DeptDemo() {
  const script = async (a: Act<DeptS>) => {
    await a.wait(900);
    await pick(a, 'add', { menu: true }, 'p-0', { added: true }, { menu: false });
    await a.set({ toast: true }); await a.move('rest'); await a.wait(2400);
    await a.click('undo'); await a.set({ added: false, toast: false }); await a.move('rest'); await a.wait(1400);
  };
  const rows: [string, string[], string?][] = [['Finance', FIN, 'add'], ['Operations', ['Ravi Kumar', 'Anita Bose', 'Sam Lee', 'Divya Nair', 'Omar Ali']], ['Sales', ['Leela Rao', 'Tom Hart', 'Zara Khan']]];
  return (
    <Shell<DeptS> title="Departments" initial={{ menu: false, added: false, toast: false }} poster={{ menu: false, added: true, toast: true }} script={script}>
      {(s, rect) => (
        <>
          <div className="tf-rows">
            {rows.map(([d, ppl, t]) => {
              const names = t && s.added ? [...ppl, 'Neha Rao'] : ppl;
              return (
                <div key={d} className="tf-dept">
                  <Text className="tf-t">{d}</Text>
                  <Facepile names={names} size={24} />
                  <span className="tf-meta"><Count value={names.length} /> members</span>
                  {t ? <Button size="small" icon={<Plus size={13} />} data-target={t} data-open={s.menu || undefined}><span>Add</span></Button> : <span />}
                </div>
              );
            })}
            {[110, 84].map((w) => <div key={w} className="tf-dept"><Bar w={w} h={7} tone={3} /><Bar w={60} h={22} r={11} tone={1} /><Bar w={56} h={6} tone={2} /><span /></div>)}
          </div>
          <Popover show={s.menu} origin="top right" className="tf-pop" style={{ left: rect('add').x + rect('add').width - 190, top: rect('add').y + rect('add').height + 6, width: 190 }}>
            <Menu items={['Neha Rao', 'Vikram Singh'].map((p) => <span className="tf-org"><Avatar name={p} size={18} />{p}</span>)} targets={['p-0', 'p-1']} />
          </Popover>
          <Toast show={s.toast} className="tf-toast" icon={<CheckIco size={14} />} action={<span data-target="undo" data-cursor="pointer" className="tf-undo">Undo</span>}>Neha Rao added to Finance</Toast>
        </>
      )}
    </Shell>
  );
}

/* ───────── Dashboard: change the period and every number follows */
const PERIODS = [
  { open: 24, overdue: 3, today: 5, done: [4, 6, 5, 8, 7, 9, 6] },
  { open: 61, overdue: 8, today: 5, done: [18, 22, 19, 27, 25, 30, 28] },
  { open: 142, overdue: 11, today: 5, done: [60, 72, 81, 95, 88, 104, 118] },
];
type DashS = { period: number };
export function DashDemo() {
  const script = async (a: Act<DashS>) => {
    for (const p of [1, 2, 0]) { await a.wait(p === 1 ? 1200 : 2600); await a.click(`pr-${p}`); await a.set({ period: p }); await a.move('rest'); }
    await a.wait(1600);
  };
  return (
    <Shell<DashS> title="Dashboard" initial={{ period: 0 }} poster={{ period: 1 }} script={script}>
      {(s) => {
        const d = PERIODS[s.period];
        return (
          <>
            <Segmented items={['This week', 'This month', 'All time']} value={s.period} targets={['pr-0', 'pr-1', 'pr-2']} className="tf-seg" />
            <div className="tf-kpis">
              {([['Open tasks', d.open], ['Overdue', d.overdue], ['Due today', d.today]] as const).map(([l, v], i) => (
                <div key={l} className="tf-kpi" data-lead={i === 0 || undefined}><span>{l}</span><b><Count value={v} /></b></div>
              ))}
            </div>
            <div className="tf-chart"><span className="tf-meta">Completed</span><Chart data={d.done} width={396} height={104} /></div>
          </>
        );
      }}
    </Shell>
  );
}

/* ───────── Tasks: one task moves through its statuses as its subtasks are ticked */
const STATUS = ['Not yet started', 'Started', 'Pending', 'Completed this cycle', 'Completed'];
const TONE = ['neutral', 'warning', 'warning', 'success', 'success'] as const;
const SUBS = ['Final copy', 'QA sign-off', 'Go live'];
type TaskS = { menu: boolean; status: number; ticks: number };
export function TaskDemo() {
  const script = async (a: Act<TaskS>) => {
    await a.wait(900);
    await pick(a, 'status', { menu: true }, 'st-1', { status: 1 }, { menu: false });
    await a.wait(500);
    for (let i = 0; i < 3; i++) { await a.click(`c-${i}`); await a.set({ ticks: i + 1 }); await a.wait(300); }
    await pick(a, 'status', { menu: true }, 'st-4', { status: 4 }, { menu: false });
    await a.move('rest'); await a.wait(2400);
    await pick(a, 'status', { menu: true }, 'st-0', { status: 0 }, { menu: false });
    for (const n of [2, 1, 0]) { await a.set({ ticks: n }); await a.wait(70); }
    await a.move('rest'); await a.wait(1200);
  };
  return (
    <Shell<TaskS> title="Task" initial={{ menu: false, status: 0, ticks: 0 }} poster={{ menu: false, status: 4, ticks: 3 }} script={script}>
      {(s, rect) => (
        <>
          <div className="tf-task-head">
            <div><div className="tf-h">Website launch</div><Text className="tf-meta">Marketing · Due Dec 2</Text></div>
            <span data-target="status" data-cursor="pointer" className="tf-status"><Badge tone={TONE[s.status]}><Roll>{STATUS[s.status]}</Roll></Badge></span>
          </div>
          <div className="tf-meta tf-label">Subtasks <Count value={s.ticks} />/3</div>
          <div className="tf-subs">
            {SUBS.map((t, i) => (
              <div key={t} className="tf-sub" data-target={`c-${i}`} data-cursor="pointer"><Check on={s.ticks > i} /><Text className="tf-t" data-done={s.ticks > i || undefined}>{t}</Text><Avatar name={['Priya Shah', 'Arjun Mehta', 'Neha Rao'][i]} size={20} /></div>
            ))}
          </div>
          <Popover show={s.menu} origin="top right" className="tf-pop" style={{ left: rect('status').x + rect('status').width - 200, top: rect('status').y + rect('status').height + 6, width: 200 }}>
            <Menu items={STATUS} targets={STATUS.map((_, i) => `st-${i}`)} value={s.status} />
          </Popover>
        </>
      )}
    </Shell>
  );
}

/* ───────── Reminders and cycles: pick how often it repeats */
const FREQ = ['Once', 'Daily', 'Weekly', 'Monthly'];
const NEXT = ['Due Nov 28', 'Reopens tomorrow', 'Reopens Nov 19', 'Reopens Dec 1'];
type RemS = { freq: number; email: boolean; toast: boolean };
export function RemindDemo() {
  const script = async (a: Act<RemS>) => {
    await a.wait(900);
    await a.click('f-3'); await a.set({ freq: 3 }); await a.wait(800);
    await a.click('email'); await a.set({ email: true }); await a.wait(500);
    await a.set({ toast: true }); await a.move('rest'); await a.wait(2400);
    await a.set({ toast: false }); await a.click('f-2'); await a.set({ freq: 2 }); await a.wait(1600);
    await a.click('email'); await a.set({ email: false }); await a.wait(300);
    await a.click('f-0'); await a.set({ freq: 0 }); await a.move('rest'); await a.wait(1400);
  };
  return (
    <Shell<RemS> title="Monthly invoice run" initial={{ freq: 0, email: false, toast: false }} poster={{ freq: 3, email: true, toast: true }} script={script}>
      {(s) => (
        <>
          <div className="tf-label tf-meta">Repeat</div>
          <Segmented items={FREQ} value={s.freq} targets={FREQ.map((_, i) => `f-${i}`)} className="tf-seg" />
          <div className="tf-next"><Bell size={15} /><Roll>{NEXT[s.freq]}</Roll></div>
          <div className="tf-setting" data-target="email" data-cursor="pointer"><span><b>Email a reminder</b><Text className="tf-meta">Every weekday at 9:00 AM</Text></span><Toggle on={s.email} /></div>
          <div className="tf-setting"><span><Bar w={130} h={7} tone={3} /><Bar w={90} h={5} tone={2} /></span><Bar w={34} h={20} r={10} tone={1} /></div>
          <Toast show={s.toast} className="tf-toast" icon={<Bell size={14} />}>Reminder set for Dec 1, 9:00 AM</Toast>
        </>
      )}
    </Shell>
  );
}

/* ───────── Templates: one click creates the task and all its subtasks */
const TPL_SUBS = ['Kickoff call', 'Collect documents', 'Set up access'];
type TplS = { open: boolean; n: number };
export function TemplateDemo() {
  const script = async (a: Act<TplS>) => {
    await a.wait(900);
    await a.click('use'); await a.set({ open: true }); await a.wait(250);
    for (let i = 1; i <= 5; i++) { await a.set({ n: i }); await a.wait(90); }
    await a.move('rest'); await a.wait(2600);
    await a.click('close');
    for (const n of [4, 3, 2, 1, 0]) { await a.set({ n }); await a.wait(50); }
    await a.set({ open: false }); await a.move('rest'); await a.wait(1300);
  };
  return (
    <Shell<TplS> title="Task templates" initial={{ open: false, n: 0 }} poster={{ open: true, n: 5 }} script={script}>
      {(s) => (
        <>
          <div className="tf-rows">
            {([['Client onboarding', 5, 'use'], ['Monthly invoice run', 3]] as const).map(([t, n, tg]) => (
              <div key={t} className="tf-tpl"><span><Text className="tf-t">{t}</Text><Text className="tf-meta">{`${n} subtasks`}</Text></span>
                {tg ? <Button size="small" variant="primary" data-target={tg}><span>Use template</span></Button> : <Bar w={86} h={24} r={8} tone={1} />}</div>
            ))}
          </div>
          <Collapse open={s.open} reveal="drop">
            <div className="tf-made">
              <div className="tf-made-head"><span><b>Client onboarding</b><Badge tone="neutral">Not yet started</Badge></span><span data-target="close" data-cursor="pointer" className="tf-x"><X size={14} /></span></div>
              {[0, 1, 2, 3, 4].map((i) => (
                <Collapse key={i} open={s.n > i}>
                  <div className="tf-sub"><Check on={false} />{i < 3 ? <Text className="tf-t">{TPL_SUBS[i]}</Text> : <Bar w={[110, 84][i - 3]} h={7} tone={3} />}<Avatar plain size={20} /></div>
                </Collapse>
              ))}
            </div>
          </Collapse>
        </>
      )}
    </Shell>
  );
}

/* ───────── Calendar: click a day to see its plan */
const PLANS: Record<number, [string, string, string][]> = {
  14: [['Quarterly VAT filing', 'Due', 'warning'], ['Vendor call', 'Starts', 'neutral']],
  21: [['Payroll run', 'Due', 'warning'], ['QA sign-off', 'Starts', 'neutral']],
};
const EVENTS: Record<number, string> = { 14: 'VAT', 19: '', 21: 'Payroll', 26: '' };
type CalS = { day: number | null };
export function CalendarDemo() {
  const script = async (a: Act<CalS>) => {
    await a.wait(900);
    await a.click('d-14'); await a.set({ day: 14 }); await a.wait(2400);
    await a.click('d-21'); await a.set({ day: null }); await a.wait(150); await a.set({ day: 21 }); await a.wait(2400);
    await a.key('esc'); await a.set({ day: null }); await a.move('rest'); await a.wait(1200);
  };
  return (
    <Shell<CalS> title="Calendar · November" initial={{ day: null }} poster={{ day: 14 }} script={script}>
      {(s, rect) => (
        <>
          <div className="tf-cal">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="tf-dow">{d}</span>)}
            {Array.from({ length: 21 }, (_, i) => i + 10).map((d) => (
              <span key={d} className="tf-day" data-today={d === 12 || undefined} data-sel={s.day === d || undefined} data-target={`d-${d}`} data-cursor="pointer">
                <span className="tf-num">{d}</span>
                {d in EVENTS && (EVENTS[d] ? <span className="tf-ev">{EVENTS[d]}</span> : <Bar w={40} h={14} r={4} tone={1} />)}
              </span>
            ))}
          </div>
          {s.day && (
            <Popover show={!!s.day} className="tf-pop tf-plan" origin="top right" style={{ left: rect(`d-${s.day}`).x - 228, top: rect(`d-${s.day}`).y, width: 220 }}>
              <div className="tf-plan-head">{s.day === 14 ? 'Friday, Nov 14' : 'Friday, Nov 21'}</div>
              {PLANS[s.day].map(([t, k, tone]) => <div key={t} className="tf-plan-row"><Text className="tf-t">{t}</Text><Badge tone={tone as 'warning' | 'neutral'}>{k}</Badge></div>)}
            </Popover>
          )}
        </>
      )}
    </Shell>
  );
}

/* ───────── Roles: what each role can do */
const ROLES = ['Admin', 'Employee', 'Platform admin'];
const PERMS: [string, number[]][] = [
  ['Create and assign tasks', [1, 0, 0]],
  ['Update their own tasks', [1, 1, 0]],
  ['Manage members and departments', [1, 0, 1]],
  ['Look after every organization', [0, 0, 1]],
];
type RoleS = { role: number };
export function RolesDemo() {
  const script = async (a: Act<RoleS>) => {
    for (const r of [1, 2, 0]) { await a.wait(r === 1 ? 1100 : 2600); await a.click(`r-${r}`); await a.set({ role: r }); await a.move('rest'); }
    await a.wait(1600);
  };
  return (
    <Shell<RoleS> title="Roles" initial={{ role: 0 }} poster={{ role: 1 }} script={script}>
      {(s) => (
        <>
          <Segmented items={ROLES} value={s.role} targets={['r-0', 'r-1', 'r-2']} className="tf-seg" />
          <div className="tf-rows">
            {PERMS.map(([p, on]) => <div key={p} className="tf-setting"><Text className="tf-t">{p}</Text><Toggle on={!!on[s.role]} /></div>)}
          </div>
        </>
      )}
    </Shell>
  );
}

/* ───────── Reports: switch the report, then export it */
const DEPTS = ['Finance', 'Ops', 'Sales', 'HR', 'IT', 'Legal'];
const REPORTS = [[82, 64, 71, 90, 58, 76], [12, 19, 9, 6, 14, 4]];
type RepS = { tab: number; menu: boolean; exp: 'idle' | 'busy' | 'done' };
export function ReportsDemo() {
  const script = async (a: Act<RepS>) => {
    await a.wait(900);
    await a.click('tb-1'); await a.set({ tab: 1 }); await a.wait(1500);
    await pick(a, 'export', { menu: true }, 'x-0', { menu: false }, { exp: 'busy' });
    await a.move('rest'); await a.wait(1100); await a.set({ exp: 'done' }); await a.wait(2400);
    await a.set({ exp: 'idle' }); await a.click('tb-0'); await a.set({ tab: 0 }); await a.move('rest'); await a.wait(1400);
  };
  return (
    <Shell<RepS> title="Reports" initial={{ tab: 0, menu: false, exp: 'idle' }} poster={{ tab: 1, menu: false, exp: 'done' }} script={script}>
      {(s, rect) => (
        <>
          <div className="tf-head">
            <Segmented items={['Completion', 'Workload']} value={s.tab} targets={['tb-0', 'tb-1']} />
            <Button data-target="export" data-open={s.menu || undefined} variant={s.exp === 'done' ? 'secondary' : 'primary'}>
              <States value={s.exp} states={{ idle: <span>Export</span>, busy: <span className="tf-org"><Spinner size={13} />Exporting</span>, done: <span className="tf-org"><CheckIco size={14} />Excel ready</span> }} />
            </Button>
          </div>
          <div className="tf-chart">
            <span className="tf-meta"><Swap id={s.tab}>{s.tab ? 'Open tasks by department' : 'Completed on time, %'}</Swap></span>
            <Chart kind="bars" data={REPORTS[s.tab]} width={396} height={150} max={s.tab ? 20 : 100} />
            <div className="tf-axis">{DEPTS.map((d) => <span key={d}>{d}</span>)}</div>
          </div>
          <Popover show={s.menu} origin="top right" className="tf-pop" style={{ left: rect('export').x + rect('export').width - 170, top: rect('export').y + rect('export').height + 6, width: 170 }}>
            <Menu items={['Excel, with charts', 'PDF']} targets={['x-0', 'x-1']} />
          </Popover>
        </>
      )}
    </Shell>
  );
}

export const DEMOS: Record<string, () => JSX.Element> = {
  organizations: OrgDemo, departments: DeptDemo, dashboard: DashDemo, tasks: TaskDemo, reminders: RemindDemo,
  templates: TemplateDemo, calendar: CalendarDemo, roles: RolesDemo, reports: ReportsDemo,
};
