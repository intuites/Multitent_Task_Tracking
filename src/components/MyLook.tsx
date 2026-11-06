import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Palette, RotateCcw, Sun, Type } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { applyLook, loadJakarta, restoreLook, useTheme, type FontFamily, type Prefs, type TextSize, type ThemePref } from '../lib/theme';
import { contrast } from '../lib/palette';
import { QUICK } from '../lib/brandColors';

const GREEN = '#2e7d4f';
const THEMES: [ThemePref, string, typeof Sun][] = [['dark', 'Dark', Moon], ['light', 'Light', Sun], ['system', 'Match device', Monitor]];
const FONTS: [FontFamily | undefined, string, string][] = [[undefined, 'Organization default', ''], ['fabric', 'Fabric Grotesk', 'Modern and compact'], ['jakarta', 'Plus Jakarta Sans', 'Rounded and friendly']];
const SIZES: [TextSize | undefined, string][] = [[undefined, 'Organization default'], ['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']];
const same = (a: Prefs, b: Prefs) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
/** drop the fields that follow the organization, so they keep following it */
const clean = (p: Prefs): Prefs => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Prefs;

/** Profile → Appearance: anyone's own theme, color, font, italic and text size. Previews live; Save keeps it on every device. */
export default function MyLook() {
  const { membership, prefs, savePrefs } = useAuth();
  const theme = useTheme();
  const [draft, setDraft] = useState<Prefs>(prefs);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (p: Partial<Prefs>) => { setDraft((d) => clean({ ...d, ...p })); setMsg(null); };
  useEffect(() => { applyLook(membership, draft); }, [draft, membership]);
  useEffect(() => () => restoreLook(), []); // leaving without saving: back to the saved look
  useEffect(loadJakarta, []); // so its card shows the real font
  const dirty = !same(clean({ ...draft, theme: undefined }), clean({ ...prefs, theme: undefined }));
  const org = membership?.brand_color ?? GREEN;
  const italic = draft.style === undefined ? undefined : draft.style === 'expressive';

  async function save() {
    try { await savePrefs(clean({ ...draft, theme: prefs.theme })); setMsg({ ok: true, text: 'Saved. This is how Taskify looks for you on every device.' }); }
    catch (x) { setMsg({ ok: false, text: (x as Error).message }); }
  }

  return (
    <section className="card os-sec ml" aria-labelledby="ml-h">
      <header><h3 id="ml-h"><Palette size={16} aria-hidden="true" /> Your appearance</h3>
        <p className="muted">Only you see these. Anything set to the organization's default follows what your admin picks for {membership?.org_name}.</p></header>

      <div className="ml-row"><span className="fp-label" id="ml-theme">Theme</span>
        <div className="seg ml-seg" role="group" aria-labelledby="ml-theme">
          {THEMES.map(([v, l, Icon]) => <button key={v} type="button" aria-pressed={theme.pref === v} onClick={() => theme.set(v)}><Icon size={15} aria-hidden="true" />{l}</button>)}
        </div>
        <small className="muted">Changes straight away. Dark is the default.</small></div>

      <div className="ml-row"><span className="fp-label" id="ml-color">Color</span>
        <div className="brand-swatches" role="group" aria-labelledby="ml-color">
          <Swatch name={`Organization color${membership?.brand_color ? '' : ' (Green classic)'}`} fill={org} on={!draft.color} pick={() => set({ color: undefined })} ring />
          {QUICK.map(([name, hex]) => <Swatch key={name} name={name} fill={hex ?? GREEN} on={draft.color === (hex ?? 'default')} pick={() => set({ color: hex ?? 'default' })} />)}
          <label className="brand-custom" title="Pick any color">
            <input type="color" value={draft.color && draft.color !== 'default' ? draft.color : org} onChange={(e) => set({ color: e.target.value })} aria-label="Custom color" />Custom
          </label>
        </div>
        <small className="muted">{!draft.color ? 'Following the organization color.' : draft.color === 'default' ? 'Green classic.' : `${QUICK.find(([, h]) => h === draft.color)?.[0] ?? 'Custom color'}, ${draft.color.toUpperCase()}.`}</small></div>

      <div className="ml-row"><span className="fp-label" id="ml-font"><Type size={14} aria-hidden="true" /> Font</span>
        <div className="fp-fams" role="group" aria-labelledby="ml-font">
          {FONTS.map(([f, n, hint]) => (
            <button key={n} type="button" className="fp-opt" data-ff={f ?? membership?.font_family ?? 'fabric'} aria-pressed={draft.font === f} onClick={() => set({ font: f })}>
              <span className="fp-aa" aria-hidden="true">Aa</span><b>{n}</b><small>{hint || 'What your admin picked'}</small>
            </button>))}
        </div></div>

      <div className="ml-row"><span className="fp-label" id="ml-it">Italic titles and big numbers</span>
        <div className="seg ml-seg" role="group" aria-labelledby="ml-it">
          {([[undefined, 'Organization default'], [false, 'Off'], [true, 'On']] as const).map(([v, l]) =>
            <button key={l} type="button" aria-pressed={italic === v} onClick={() => set({ style: v === undefined ? undefined : v ? 'expressive' : 'classic' })}>{l}</button>)}
        </div></div>

      <div className="ml-row"><span className="fp-label" id="ml-size">Text size</span>
        <div className="seg ml-seg" role="group" aria-labelledby="ml-size">
          {SIZES.map(([v, l]) => <button key={l} type="button" aria-pressed={draft.size === v} onClick={() => set({ size: v })}>{l}</button>)}
        </div></div>

      <div className="os-save on ml-save">
        <span className={dirty ? 'os-dirty' : 'muted'} role="status">{msg ? msg.text : dirty ? 'Previewing. Save to keep it.' : 'All changes saved.'}</span>
        {(draft.color || draft.font || draft.style || draft.size) && <button type="button" className="link" onClick={() => set({ color: undefined, font: undefined, style: undefined, size: undefined })}><RotateCcw size={14} aria-hidden="true" />Use organization defaults</button>}
        {dirty && <button type="button" className="link" onClick={() => { setDraft(prefs); setMsg(null); }}>Discard</button>}
        <button type="button" onClick={save} disabled={!dirty}>Save my appearance</button>
      </div>
      {msg && !msg.ok && <p role="alert" className="form-alert">{msg.text}</p>}
    </section>
  );
}

function Swatch({ name, fill, on, pick, ring }: { name: string; fill: string; on: boolean; pick: () => void; ring?: boolean }) {
  const ink = contrast(fill, '#ffffff') >= contrast(fill, '#111214') ? '#ffffff' : '#111214';
  return <button type="button" className={`brand-swatch${ring ? ' ml-org' : ''}`} style={{ '--sw': fill, color: ink } as React.CSSProperties}
    aria-pressed={on} aria-label={name} title={name} onClick={pick}>{on && <Check size={15} aria-hidden="true" />}</button>;
}
