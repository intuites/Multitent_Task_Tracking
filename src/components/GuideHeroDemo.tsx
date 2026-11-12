import { CalendarDays, LayoutDashboard, ListChecks, Plus, BarChart3 } from 'lucide-react';
import { Stage, Window, Bar, Text, type Act } from '../stageshow/kit';
import { Avatar } from '../stageshow/kit/parts';
import { Badge, Button, Field } from '../stageshow/kit/controls';
import { Collapse, Popover, Roll } from '../stageshow/kit/motion';
import { Menu } from '../stageshow/kit/parts';
import { useTheme } from '../lib/theme';
import './guideHeroDemo.css';

// The Guide's hero: an admin creates a task, assigns it to Priya in Finance,
// Priya is told by email, and the task moves to Started.

type Status = 'Not yet started' | 'Started';
type S = { open: boolean; title: string; typing: boolean; pick: boolean; who: string; added: boolean; status: Status; note: boolean };

const initial: S = { open: false, title: '', typing: false, pick: false, who: '', added: false, status: 'Not yet started', note: false };
const TITLE = 'Quarterly VAT filing';
const PEOPLE = ['Priya Shah', 'Arjun Mehta', 'Neha Rao'];
const POSTER: S = { ...initial, title: TITLE, who: PEOPLE[0], added: true, status: 'Started', note: true };
const REST = { wide: { x: 430, y: 112 }, compact: { x: 280, y: 110 } };

async function script(a: Act<S>) {
  await a.wait(700);
  // open the form from the toolbar
  await a.click('new');
  await a.set({ open: true, typing: true });
  await a.wait(350);
  await a.type('title', TITLE);
  await a.wait(300);
  // pick who it is for
  await a.click('assign');
  await a.set({ typing: false, pick: true });
  await a.wait(450);
  await a.move('p-0');
  await a.wait(250);
  await a.click();
  await a.set({ who: PEOPLE[0] });
  await a.set({ pick: false });
  await a.wait(450);
  // create it: the form closes and the task lands at the top of the list
  await a.click('create');
  await a.set({ open: false });
  await a.wait(120);
  await a.set({ added: true });
  await a.move('rest');
  await a.wait(700);
  // Priya hears about it, and starts it
  if (a.layout === 'wide') await a.set({ note: true });
  await a.wait(1300);
  await a.set({ status: 'Started' });
  await a.wait(2800);
  // the new task and its email leave together, then the scene resets unseen
  await a.set({ note: false, added: false });
  await a.wait(700);
  await a.snap({ ...initial });
  await a.wait(300);
}

export default function GuideHeroDemo() {
  const { theme } = useTheme();
  return (
    <Stage width={620} height={440} compact={{ below: 520, width: 358, height: 400 }} initial={initial} poster={POSTER} script={script}
      cursor={{ at: REST }} fill theme={theme === 'dark' ? 'dark' : 'light'} className="tk-demo">
      {(s, rect, layout) => {
        const wide = layout === 'wide';
        const nb = rect('new'), af = rect('assign');
        return (
          <>
            <Window className="tk-win" sidebar={wide ? <Side /> : undefined} sidebarWidth={132} title={wide ? undefined : 'Tasks'}>
              <div className="tk-main">
                {wide && <div className="tk-title">Tasks</div>}
                <div className="tk-tools">
                  <Button variant="primary" icon={<Plus size={14} strokeWidth={2} />} data-target="new" data-open={s.open || undefined}><span>New task</span></Button>
                  <Bar w={120} h={28} r={8} tone={1} />
                </div>
                <div className="tk-list">
                  <div className="tk-row head"><Bar w={44} h={6} tone={2} /><span /><Bar w={38} h={6} tone={2} /><Bar w={30} h={6} tone={2} /></div>
                  <Collapse open={s.added} reveal="drop">
                    <div className="tk-row">
                      <span className="tk-name"><Text className="tk-t">{TITLE}</Text><Text className="tk-sub">Finance · Due Nov 28</Text></span>
                      <Avatar name="Priya Shah" size={24} tone="accent" />
                      <Badge tone={s.status === 'Started' ? 'warning' : 'neutral'}><Roll>{s.status}</Roll></Badge>
                      <Bar w={46} h={6} tone={2} />
                    </div>
                  </Collapse>
                  <div className="tk-row">
                    <span className="tk-name"><Text className="tk-t">Monthly invoice run</Text><Text className="tk-sub">Finance · Due Nov 14</Text></span>
                    <Avatar name="Arjun Mehta" size={24} />
                    <Badge tone="success">Completed</Badge>
                    <Bar w={40} h={6} tone={2} />
                  </div>
                  {[[118, 70, 64], [96, 58, 72], [130, 76, 56], [104, 62, 68]].map(([t, sub, b], i) => (
                    <div key={i} className="tk-row">
                      <span className="tk-name"><Bar w={t} h={7} tone={3} /><Bar w={sub} h={5} tone={2} /></span>
                      <Avatar plain size={24} />
                      <Bar w={b} h={20} r={6} tone={1} />
                      <Bar w={42} h={6} tone={2} />
                    </div>
                  ))}
                </div>
              </div>
            </Window>

            {/* the new-task form, anchored under its button */}
            <Popover show={s.open} className="tk-form" style={{ left: nb.x, top: nb.y + nb.height + 8 }}>
              <div className="tk-form-head">New task</div>
              <Field label="Title" value={s.title} placeholder="What needs doing?" focused={s.typing} box={{ 'data-target': 'title' }} />
              <Field label="Assign to" value={s.who} placeholder="Finance · pick a member" focused={s.pick}
                leading={s.who ? <Avatar name={s.who} size={18} tone="accent" /> : undefined} box={{ 'data-target': 'assign', 'data-cursor': 'pointer' }} />
              <div className="tk-form-foot"><Button variant="primary" data-target="create"><span>Create task</span></Button></div>
            </Popover>
            <Popover show={s.pick} className="tk-people" style={{ left: af.x, top: af.y + af.height + 4, width: af.width }}>
              <Menu items={PEOPLE.map((p) => <span className="tk-person"><Avatar name={p} size={18} tone={p === PEOPLE[0] ? 'accent' : 'person'} />{p}</span>)} targets={['p-0', 'p-1', 'p-2']} />
            </Popover>

            {/* the email Priya gets, over the sidebar */}
            {wide && (
              <div className="tk-note" data-show={s.note || undefined}>
                <Avatar name="Priya Shah" size={28} tone="accent" />
                <div className="tk-note-text"><b>New task for you</b><span>{TITLE}</span><small>Due Nov 28 · emailed to Priya</small></div>
              </div>
            )}
            <span data-target="rest" style={{ position: 'absolute', left: REST[layout].x, top: REST[layout].y }} />
          </>
        );
      }}
    </Stage>
  );
}

function Side() {
  const nav: [typeof ListChecks, number | string][] = [[LayoutDashboard, 62], [ListChecks, 'Tasks'], [CalendarDays, 54], [BarChart3, 48]];
  return (
    <div className="tk-side">
      <div className="tk-brand"><span className="tk-mark" aria-hidden="true">T</span>Taskify</div>
      {nav.map(([Ico, l], i) => (
        <div key={i} className="tk-nav" data-on={typeof l === 'string' || undefined}>
          <Ico size={16} strokeWidth={1.75} />{typeof l === 'string' ? <span>{l}</span> : <Bar w={l} h={6} tone={2} />}
        </div>
      ))}
    </div>
  );
}
