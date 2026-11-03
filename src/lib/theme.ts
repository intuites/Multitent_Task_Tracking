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
