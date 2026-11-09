import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Palette, RotateCcw, Sun, Type } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { applyLook, loadJakarta, lookOf, restoreLook, useTheme, DEFAULT_COLOR, LOOK_KEYS, type FontFamily, type Look, type TextSize, type ThemePref } from '../lib/theme';
import { contrast } from '../lib/palette';
import { FAMILIES, QUICK, TRENDING } from '../lib/brandColors';
import BrandPreview from './BrandPreview';

/** every color under "More colors", hex → name */
const MORE = new Map<string, string>([...FAMILIES.flatMap((f) => f.colors.map((c) => [c.hex, c.name] as const)), ...TRENDING.map((t) => [t.hex, t.name] as const)]);

// colors are saved as their hex, so a later change of Taskify's default never changes someone's own look
const THEMES: [ThemePref, string, typeof Sun][] = [['dark', 'Dark', Moon], ['light', 'Light', Sun], ['system', 'Match device', Monitor]];
const FONTS: [FontFamily, string, string][] = [['fabric', 'Fabric Grotesk', 'Modern and compact'], ['jakarta', 'Plus Jakarta Sans', 'Rounded and friendly'], ['lora', 'Lora', 'A classic serif']];
const SIZES: [TextSize, string][] = [['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']];
const sameLook = (a: Look, b: Look) => LOOK_KEYS.every((k) => a[k] === b[k]);

/** Profile → Appearance: anyone's own theme, color, font, italic and text size. Only that person sees it:
 *  the look is saved with their account (lib/auth keeps one for everyone), so an admin's organization changes never reach it. */
export default function MyLook() {
  const { membership, prefs, savePrefs } = useAuth();
  const theme = useTheme();
  const saved = lookOf(prefs, membership);
  const orgLook = lookOf({}, membership);
  const [draft, setDraft] = useState<Look>(saved);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (p: Partial<Look>) => { setDraft((d) => ({ ...d, ...p })); setMsg(null); };
  // saved look changed underneath (saved here, or the organization's look while you follow it): show that
  const savedKey = LOOK_KEYS.map((k) => saved[k]).join('|');
  useEffect(() => { setDraft(lookOf(prefs, membership)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { applyLook(membership, draft); }, [draft, membership]);
  useEffect(() => () => restoreLook(), []); // leaving without saving: back to the saved look
  useEffect(loadJakarta, []); // so its card shows the real font
  const dirty = !sameLook(draft, saved);

  async function save() {
    try { await savePrefs({ ...prefs, ...draft }); setMsg({ ok: true, text: 'Saved as your own look, on every device.' }); }
    catch (x) { setMsg({ ok: false, text: (x as Error).message }); }
  }
  // copies the organization's current look into the draft; saving keeps it as this person's own
  const useOrgLook = () => { setDraft(orgLook); setMsg(null); };
  const colorName = QUICK.find(([, h]) => (h ?? DEFAULT_COLOR) === draft.color)?.[0] ?? MORE.get(draft.color) ?? 'Custom color';

  return (
    <section className="card os-sec ml" aria-labelledby="ml-h">
      <header><h3 id="ml-h"><Palette size={16} aria-hidden="true" /> Your appearance</h3>
        <p className="muted">Only you see this look, on every device you sign in on. No one else's choices change it, and yours don't change anyone else's.</p></header>

      <div className="ml-row"><span className="fp-label" id="ml-theme">Theme</span>
        <div className="seg ml-seg" role="group" aria-labelledby="ml-theme">
          {THEMES.map(([v, l, Icon]) => <button key={v} type="button" aria-pressed={theme.pref === v} onClick={() => theme.set(v)}><Icon size={15} aria-hidden="true" />{l}</button>)}
        </div>
        <small className="muted">Always yours, and changes straight away. Dark is the default.</small></div>

      <div className="ml-row"><span className="fp-label" id="ml-color">Color</span>
        <div className="brand-swatches" role="group" aria-labelledby="ml-color">
          {QUICK.map(([name, hex]) => <Swatch key={name} name={hex ? name : `${name} (default)`} fill={hex ?? DEFAULT_COLOR} on={draft.color === (hex ?? DEFAULT_COLOR)} pick={() => set({ color: hex ?? DEFAULT_COLOR })} />)}
          <label className="brand-custom" title="Pick any color">
            <input type="color" value={draft.color} onChange={(e) => set({ color: e.target.value })} aria-label="Custom color" />Custom
          </label>
        </div>
        {/* the same full list admins pick the organization color from */}
        <details className="brand-more">
          <summary>More colors ({MORE.size})</summary>
          <div className="brand-fams">
            {FAMILIES.map((f) => (
              <div key={f.family} className="brand-fam" role="group" aria-label={f.family}>
                <small>{f.family}</small>
                <span>{f.colors.map((c) => <Swatch key={c.hex} name={c.name} fill={c.hex} on={draft.color === c.hex} pick={() => set({ color: c.hex })} small />)}</span>
              </div>))}
            <div className="brand-fam trending" role="group" aria-label="Colors of the year">
              <small>Colors of the year</small>
              <span>{TRENDING.map((c) => <Swatch key={c.hex} name={c.name} fill={c.hex} on={draft.color === c.hex} pick={() => set({ color: c.hex })} small />)}</span>
            </div>
          </div>
        </details>
        <small className="muted">{colorName}, {draft.color.toUpperCase()}. How it looks in each mode:</small>
        <BrandPreview color={draft.color} /></div>

      <div className="ml-row"><span className="fp-label" id="ml-font"><Type size={14} aria-hidden="true" /> Font</span>
        <div className="fp-fams" role="group" aria-labelledby="ml-font">
          {FONTS.map(([f, n, hint]) => (
            <button key={f} type="button" className="fp-opt" data-ff={f} aria-pressed={draft.font === f} onClick={() => set({ font: f })}>
              <span className="fp-aa" aria-hidden="true">Aa</span><b>{n}</b><small>{hint}</small>
            </button>))}
        </div></div>

      <div className="ml-row"><span className="fp-label" id="ml-it">Italic titles and big numbers</span>
        <div className="seg ml-seg" role="group" aria-labelledby="ml-it">
          {([['classic', 'Off'], ['expressive', 'On']] as const).map(([v, l]) =>
            <button key={v} type="button" aria-pressed={draft.style === v} onClick={() => set({ style: v })}>{l}</button>)}
        </div></div>

      <div className="ml-row"><span className="fp-label" id="ml-size">Text size</span>
        <div className="seg ml-seg" role="group" aria-labelledby="ml-size">
          {SIZES.map(([v, l]) => <button key={v} type="button" aria-pressed={draft.size === v} onClick={() => set({ size: v })}>{l}</button>)}
        </div></div>

      <div className="os-save on ml-save">
        <span className={dirty ? 'os-dirty' : 'muted'} role="status">{msg ? msg.text : dirty ? 'Previewing. Save to keep it.' : 'Your look is saved.'}</span>
        {!sameLook(draft, orgLook) && <button type="button" className="link" onClick={useOrgLook}><RotateCcw size={14} aria-hidden="true" />Use {membership?.org_name}'s look</button>}
        {dirty && <button type="button" className="link" onClick={() => { setDraft(saved); setMsg(null); }}>Discard</button>}
        <button type="button" onClick={save} disabled={!dirty}>Save my appearance</button>
      </div>
      {msg && !msg.ok && <p role="alert" className="form-alert">{msg.text}</p>}
    </section>
  );
}

function Swatch({ name, fill, on, pick, small }: { name: string; fill: string; on: boolean; pick: () => void; small?: boolean }) {
  const ink = contrast(fill, '#ffffff') >= contrast(fill, '#111214') ? '#ffffff' : '#111214';
  return <button type="button" className={`brand-swatch${small ? ' sm' : ''}`} style={{ '--sw': fill, color: ink } as React.CSSProperties}
    aria-pressed={on} aria-label={name} title={name} onClick={pick}>{on && <Check size={small ? 13 : 15} aria-hidden="true" />}</button>;
}
