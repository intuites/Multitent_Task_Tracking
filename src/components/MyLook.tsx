import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Palette, RotateCcw, Sun, Type } from 'lucide-react';
import { useAuth, type Membership } from '../lib/auth';
import { applyLook, loadJakarta, restoreLook, useTheme, FONT_FAMILIES, FONT_STYLES, TEXT_SIZES, type FontFamily, type FontStyle, type Prefs, type TextSize, type ThemePref } from '../lib/theme';
import { contrast } from '../lib/palette';
import { QUICK } from '../lib/brandColors';

const GREEN = '#2e7d4f';
const THEMES: [ThemePref, string, typeof Sun][] = [['dark', 'Dark', Moon], ['light', 'Light', Sun], ['system', 'Match device', Monitor]];
const FONTS: [FontFamily, string, string][] = [['fabric', 'Fabric Grotesk', 'Modern and compact'], ['jakarta', 'Plus Jakarta Sans', 'Rounded and friendly'], ['lora', 'Lora', 'A classic serif']];
const SIZES: [TextSize, string][] = [['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']];
type Look = { color: string; font: FontFamily; style: FontStyle; size: TextSize };
const LOOK_KEYS = ['color', 'font', 'style', 'size'] as const;

/** The look someone sees now: their own choices, or the organization's where they have none (color 'default' = Green classic). */
const lookOf = (p: Prefs, m: Membership | null): Look => ({
  color: p.color ?? (m?.brand_color && /^#[0-9a-f]{6}$/i.test(m.brand_color) ? m.brand_color.toLowerCase() : 'default'),
  font: p.font ?? (FONT_FAMILIES.includes(m?.font_family as FontFamily) ? m!.font_family as FontFamily : 'fabric'),
  style: p.style ?? (FONT_STYLES.includes(m?.font_style as FontStyle) ? m!.font_style as FontStyle : 'classic'),
  size: p.size ?? (TEXT_SIZES.includes(m?.text_size as TextSize) ? m!.text_size as TextSize : 'normal'),
});
const sameLook = (a: Look, b: Look) => LOOK_KEYS.every((k) => a[k] === b[k]);

/** Profile → Appearance: anyone's own theme, color, font, italic and text size.
 *  Saving keeps all four as the person's own, so later changes an admin makes to the organization's appearance never reach them. */
export default function MyLook() {
  const { membership, prefs, savePrefs } = useAuth();
  const theme = useTheme();
  const own = LOOK_KEYS.some((k) => prefs[k] !== undefined);
  const saved = lookOf(prefs, membership);
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
    try { await savePrefs({ ...(prefs.theme ? { theme: prefs.theme } : {}), ...draft }); setMsg({ ok: true, text: 'Saved as your own look, on every device.' }); }
    catch (x) { setMsg({ ok: false, text: (x as Error).message }); }
  }
  async function followOrg() {
    try {
      await savePrefs(prefs.theme ? { theme: prefs.theme } : {});
      setDraft(lookOf({}, membership)); setMsg({ ok: true, text: `You now follow ${membership?.org_name}'s look.` });
    } catch (x) { setMsg({ ok: false, text: (x as Error).message }); }
  }
  const colorName = draft.color === 'default' ? 'Green classic' : QUICK.find(([, h]) => h === draft.color)?.[0] ?? 'Custom color';

  return (
    <section className="card os-sec ml" aria-labelledby="ml-h">
      <header><h3 id="ml-h"><Palette size={16} aria-hidden="true" /> Your appearance</h3>
        <p className="muted">{own
          ? `This is your own look. Changes an admin makes to ${membership?.org_name}'s appearance don't change it.`
          : `You're using ${membership?.org_name}'s look. Change anything and save to make it your own; after that, admin changes won't affect it.`}</p></header>

      <div className="ml-row"><span className="fp-label" id="ml-theme">Theme</span>
        <div className="seg ml-seg" role="group" aria-labelledby="ml-theme">
          {THEMES.map(([v, l, Icon]) => <button key={v} type="button" aria-pressed={theme.pref === v} onClick={() => theme.set(v)}><Icon size={15} aria-hidden="true" />{l}</button>)}
        </div>
        <small className="muted">Always yours, and changes straight away. Dark is the default.</small></div>

      <div className="ml-row"><span className="fp-label" id="ml-color">Color</span>
        <div className="brand-swatches" role="group" aria-labelledby="ml-color">
          {QUICK.map(([name, hex]) => <Swatch key={name} name={name} fill={hex ?? GREEN} on={draft.color === (hex ?? 'default')} pick={() => set({ color: hex ?? 'default' })} />)}
          <label className="brand-custom" title="Pick any color">
            <input type="color" value={draft.color === 'default' ? GREEN : draft.color} onChange={(e) => set({ color: e.target.value })} aria-label="Custom color" />Custom
          </label>
        </div>
        <small className="muted">{colorName}{draft.color === 'default' ? '' : `, ${draft.color.toUpperCase()}`}.</small></div>

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
        <span className={dirty ? 'os-dirty' : 'muted'} role="status">{msg ? msg.text : dirty ? 'Previewing. Save to keep it.' : own ? 'Your own look is saved.' : `Following ${membership?.org_name}'s look.`}</span>
        {own && !dirty && <button type="button" className="link" onClick={followOrg}><RotateCcw size={14} aria-hidden="true" />Go back to the organization look</button>}
        {dirty && <button type="button" className="link" onClick={() => { setDraft(saved); setMsg(null); }}>Discard</button>}
        <button type="button" onClick={save} disabled={!dirty}>Save my appearance</button>
      </div>
      {msg && !msg.ok && <p role="alert" className="form-alert">{msg.text}</p>}
    </section>
  );
}

function Swatch({ name, fill, on, pick }: { name: string; fill: string; on: boolean; pick: () => void }) {
  const ink = contrast(fill, '#ffffff') >= contrast(fill, '#111214') ? '#ffffff' : '#111214';
  return <button type="button" className="brand-swatch" style={{ '--sw': fill, color: ink } as React.CSSProperties}
    aria-pressed={on} aria-label={name} title={name} onClick={pick}>{on && <Check size={15} aria-hidden="true" />}</button>;
}
