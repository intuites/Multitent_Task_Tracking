import { useEffect, useState } from 'react';
import { brandCss } from './palette';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'tt-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

const read = (): ThemePref => {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
};
const resolve = (p: ThemePref) => (p === 'system' ? (media().matches ? 'dark' : 'light') : p);
const apply = (p: ThemePref) => { document.documentElement.dataset.theme = resolve(p); };

const BRAND_KEY = 'tt-brand-css';
const HEX = /^#[0-9a-f]{6}$/i;
/** The organization's brand color (null = default green): generates its light and dark palettes (lib/palette.ts)
 *  into one <style>, which index.html also restores from storage before first paint. */
export function applyBrand(color: string | null | undefined, remember = true) {
  const root = document.documentElement;
  const css = color && HEX.test(color) ? brandCss(color.toLowerCase()) : '';
  let el = document.getElementById('tt-brand');
  if (css) {
    if (!el) { el = document.createElement('style'); el.id = 'tt-brand'; document.head.appendChild(el); }
    el.textContent = css; root.dataset.brand = '';
  } else { el?.remove(); delete root.dataset.brand; }
  if (!remember) return;
  try { if (css) localStorage.setItem(BRAND_KEY, css); else localStorage.removeItem(BRAND_KEY); } catch { /* storage blocked: still applies now */ }
}

export const FONT_FAMILIES = ['fabric', 'jakarta', 'system'] as const;
export const FONT_STYLES = ['expressive', 'classic'] as const;
export type FontFamily = typeof FONT_FAMILIES[number];
export type FontStyle = typeof FONT_STYLES[number];
const FONT_KEY = 'tt-font';
/** Plus Jakarta Sans only downloads where it is used (an organization picked it, or the font picker shows it). */
export function loadJakarta() { import('@fontsource-variable/plus-jakarta-sans/wght.css'); import('@fontsource-variable/plus-jakarta-sans/wght-italic.css'); }
/** The organization's font family and style (null = Fabric Grotesk, expressive): set on <html data-font data-type>,
 *  which styles.css reads; index.html restores the saved pair before first paint. */
export function applyFont(family: string | null | undefined, style: string | null | undefined, remember = true) {
  const f: FontFamily = FONT_FAMILIES.includes(family as FontFamily) ? family as FontFamily : 'fabric';
  const s: FontStyle = FONT_STYLES.includes(style as FontStyle) ? style as FontStyle : 'expressive';
  if (f === 'jakarta') loadJakarta();
  const root = document.documentElement;
  root.dataset.font = f; root.dataset.type = s;
  if (!remember) return;
  try { localStorage.setItem(FONT_KEY, `${f}|${s}`); } catch { /* storage blocked: still applies now */ }
}

/** Theme preference shared by every toggle on the page; index.html applies it before first paint. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);
  useEffect(() => {
    apply(pref);
    const onSystem = () => { if (read() === 'system') apply('system'); };
    const onSync = () => setPref(read());
    media().addEventListener('change', onSystem);
    window.addEventListener('tt-theme', onSync);
    return () => { media().removeEventListener('change', onSystem); window.removeEventListener('tt-theme', onSync); };
  }, [pref]);
  const set = (p: ThemePref) => {
    try { if (p === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* private mode: still applies for this page */ }
    apply(p); setPref(p); // instant switch, no animation
    window.dispatchEvent(new Event('tt-theme'));
  };
  return { pref, theme: resolve(pref), set, toggle: () => set(resolve(pref) === 'dark' ? 'light' : 'dark') };
}
