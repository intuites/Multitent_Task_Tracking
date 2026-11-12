import { Bell, Check as CheckIco } from 'lucide-react';
import { Stage, Window, Bar, Text, type Act } from '../stageshow/kit';
import { Avatar, Check, Toast } from '../stageshow/kit/parts';
import { Count, Collapse } from '../stageshow/kit/motion';
import { useTheme } from '../lib/theme';
import './guideHeroDemo.css';
import './authDemo.css';

// The sign-in page's showcase: a person's day in Taskify. A reminder arrives, they tick off a task, the day's progress
// moves, and Undo (a visible cause) puts the loop back where it started.

type S = { note: boolean; done: boolean; toast: boolean };
const initial: S = { note: false, done: false, toast: false };
const POSTER: S = { note: true, done: true, toast: false };
const TOTAL = 4;

async function script(a: Act<S>) {
  await a.wait(900);
  await a.set({ note: true });
  await a.wait(1600);
  await a.click('tick');
  await a.set({ done: true });
  await a.wait(250);
  await a.set({ toast: true });
  await a.move('rest');
  await a.wait(2600);
  await a.click('undo');
  await a.set({ done: false, toast: false });
  await a.wait(500);
  await a.set({ note: false });
  await a.move('rest');
  await a.wait(1200);
}

export default function AuthDemo() {
  const { theme } = useTheme();
  return (
    <Stage width={500} height={420} initial={initial} poster={POSTER} script={script} fill cursor={{ at: { x: 420, y: 360 } }}
      theme={theme === 'dark' ? 'dark' : 'light'} className="tk-demo ad">
      {(s) => {
        const done = (s.done ? 3 : 2);
        return (
          <>
            <Window className="ad-win" title="Today">
              <div className="ad-body">
                <div className="ad-head">
                  <div><div className="ad-h">Thursday</div><Text className="ad-sub">4 tasks due today</Text></div>
                  <span className="ad-done"><b><Count value={done} /></b>/{TOTAL} done</span>
                </div>
                <span className="ad-meter" aria-hidden="true"><i style={{ width: `${(done / TOTAL) * 100}%` }} /></span>
                <div className="ad-list">
                  {[
                    ['Prepare board deck', '9:00 AM', 'Priya Shah', true],
                    ['Send Q4 invoices', '11:30 AM', 'Arjun Mehta', s.done],
                    ['Vendor contract review', '1:00 PM', 'Neha Rao', true],
                  ].map(([t, at, who, on], i) => (
                    <div key={t as string} className="ad-row" data-done={on || undefined} data-target={i === 1 ? 'tick' : undefined} data-cursor={i === 1 ? 'pointer' : undefined}>
                      <Check on={!!on} size={18} />
                      <span className="ad-t"><Text>{t as string}</Text><small>{at as string}</small></span>
                      <Avatar name={who as string} size={24} />
                    </div>
                  ))}
                  <div className="ad-row"><Check on={false} size={18} /><span className="ad-t"><Text>QA sign-off</Text><small>3:00 PM</small></span><Avatar name="Kiran Das" size={24} /></div>
                  <div className="ad-row ad-ghost"><Bar w={18} h={18} r={9} tone={1} /><span className="ad-t"><Bar w={150} h={7} tone={3} /><Bar w={60} h={5} tone={2} /></span><Bar w={24} h={24} r={12} tone={1} /></div>
                </div>
              </div>
            </Window>
            {/* the reminder email, a satellite straddling the window's right edge */}
            <Collapse open={s.note} reveal="drop" className="ad-note-wrap">
              <div className="ad-note">
                <span className="ad-note-ico"><Bell size={15} /></span>
                <span><b>Reminder</b><span>QA sign-off is due at 3:00&nbsp;PM</span></span>
              </div>
            </Collapse>
            <Toast show={s.toast} className="ad-toast" icon={<CheckIco size={14} />} action={<span data-target="undo" data-cursor="pointer" className="ad-undo">Undo</span>}>Marked done</Toast>
            <span data-target="rest" style={{ position: 'absolute', left: 420, top: 360 }} />
          </>
        );
      }}
    </Stage>
  );
}
