import { useEffect, useState } from 'react';
import { brandCss } from './palette';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'tt-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

// nothing chosen = dark (index.html applies the same default before first paint)
const read = (): ThemePref => {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'system' ? v : 'dark'; } catch { return 'dark'; }
};
export const themePref = read;
const resolve = (p: ThemePref) => (p === 'system' ? (media().matches ? 'dark' : 'light') : p);
const apply = (p: ThemePref) => { document.documentElement.dataset.theme = resolve(p); };

const BRAND_KEY = 'tt-brand-css';
const HEX = /^#[0-9a-f]{6}$/i;
/** Taskify's look when neither the organization nor the person picked one: Cyan, Fabric Grotesk, italic off, compact text, dark. */
export const DEFAULT_COLOR = '#0891b2';
/** The brand color (null = the default, Cyan): generates its light and dark palettes (lib/palette.ts)
 *  into one <style>, which index.html also restores from storage before first paint. */
export function applyBrand(color: string | null | undefined, remember = true) {
  const root = document.documentElement;
  const css = brandCss((color && HEX.test(color) ? color : DEFAULT_COLOR).toLowerCase());
  let el = document.getElementById('tt-brand');
  if (css) {
    if (!el) { el = document.createElement('style'); el.id = 'tt-brand'; document.head.appendChild(el); }
    el.textContent = css; root.dataset.brand = '';
  } else { el?.remove(); delete root.dataset.brand; }
  if (!remember) return;
  try { if (css) localStorage.setItem(BRAND_KEY, css); else localStorage.removeItem(BRAND_KEY); } catch { /* storage blocked: still applies now */ }
}

export const FONT_FAMILIES = ['fabric', 'jakarta', 'lora'] as const;
export const FONT_STYLES = ['expressive', 'classic'] as const;
export type FontFamily = typeof FONT_FAMILIES[number];
export type FontStyle = typeof FONT_STYLES[number];
const FONT_KEY = 'tt-font';
/** Plus Jakarta Sans only downloads where it is used (an organization picked it, or the font picker shows it). */
export function loadJakarta() { import('@fontsource-variable/plus-jakarta-sans/wght.css'); import('@fontsource-variable/plus-jakarta-sans/wght-italic.css'); }
/** The organization's font family and style (null = Fabric Grotesk, italic off): set on <html data-font data-type>,
 *  which styles.css reads; index.html restores the saved pair before first paint. */
export function applyFont(family: string | null | undefined, style: string | null | undefined, remember = true) {
  const f: FontFamily = FONT_FAMILIES.includes(family as FontFamily) ? family as FontFamily : 'fabric';
  const s: FontStyle = FONT_STYLES.includes(style as FontStyle) ? style as FontStyle : 'classic';
  if (f === 'jakarta') loadJakarta();
  const root = document.documentElement;
  root.dataset.font = f; root.dataset.type = s;
  if (!remember) return;
  try { localStorage.setItem(FONT_KEY, `${f}|${s}`); } catch { /* storage blocked: still applies now */ }
}

export const TEXT_SIZES = ['compact', 'normal', 'large'] as const;
export type TextSize = typeof TEXT_SIZES[number];
const SIZE_KEY = 'tt-size';
/** Text size on <html data-size>; styles.css scales every --fs-* token, spacing stays the same. */
export function applyTextSize(size: string | null | undefined, remember = true) {
  const s: TextSize = TEXT_SIZES.includes(size as TextSize) ? size as TextSize : 'compact';
  document.documentElement.dataset.size = s;
  if (!remember) return;
  try { localStorage.setItem(SIZE_KEY, s); } catch { /* storage blocked: still applies now */ }
}

/** A person's own look (Profile → Appearance); any field left out follows the organization. tour: the first-sign-in tour was shown. */
export interface Prefs { theme?: ThemePref; color?: string; font?: FontFamily; style?: FontStyle; size?: TextSize; tour?: 'done' }
export interface OrgLook { brand_color?: string | null; font_family?: string | null; font_style?: string | null; text_size?: string | null }
export type Look = { color: string; font: FontFamily; style: FontStyle; size: TextSize };
export const LOOK_KEYS = ['color', 'font', 'style', 'size'] as const;
/** The look someone sees: their own choices, or the organization's where they have none, or Taskify's defaults. */
export const lookOf = (p: Prefs, o: OrgLook | null): Look => ({
  color: p.color && p.color !== 'default' ? p.color : o?.brand_color && HEX.test(o.brand_color) ? o.brand_color.toLowerCase() : DEFAULT_COLOR,
  font: p.font ?? (FONT_FAMILIES.includes(o?.font_family as FontFamily) ? o!.font_family as FontFamily : 'fabric'),
  style: p.style ?? (FONT_STYLES.includes(o?.font_style as FontStyle) ? o!.font_style as FontStyle : 'classic'),
  size: p.size ?? (TEXT_SIZES.includes(o?.text_size as TextSize) ? o!.text_size as TextSize : 'compact'),
});
/** Someone with no saved look gets the one they see now saved as their own, so an admin's later change to the
 *  organization's appearance never reaches them. null = they already have one. */
export const lookToKeep = (p: Prefs, o: OrgLook | null): Prefs | null =>
  LOOK_KEYS.every((k) => p[k] !== undefined) ? null : { ...p, ...lookOf(p, o) };

let last: { org: OrgLook | null; prefs: Prefs } = { org: null, prefs: {} };
let preview: Prefs | null = null; // an unsaved look Profile → Appearance is showing; wins until restoreLook()
/** What everyone sees: the person's own choices over the organization's, over the defaults (Cyan, Fabric Grotesk, upright, compact). */
export function applyLook(org: OrgLook | null, prefs: Prefs = {}) {
  last = { org, prefs };
  const p = preview ? { ...prefs, ...preview } : prefs; // a theme switch or an organization update mid-preview keeps the preview
  applyBrand(p.color && p.color !== 'default' ? p.color : org?.brand_color);
  applyFont(p.font ?? org?.font_family, p.style ?? org?.font_style);
  applyTextSize(p.size ?? org?.text_size);
}
/** Shows an unsaved look over the saved one. */
export function previewLook(look: Prefs) { preview = look; applyLook(last.org, last.prefs); }
/** Back to the saved look after a settings page previewed something else. */
export const restoreLook = () => { preview = null; applyLook(last.org, last.prefs); };
/** The theme part of a person's saved prefs, without broadcasting a change if it's already on. */
export function applyThemePref(p: ThemePref | undefined) {
  if (!p || p === read()) return;
  try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  apply(p); window.dispatchEvent(new Event('tt-theme'));
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
    try { localStorage.setItem(KEY, p); } catch { /* private mode: still applies for this page */ }
    apply(p); setPref(p); // instant switch, no animation
    window.dispatchEvent(new Event('tt-theme'));
  };
  return { pref, theme: resolve(pref), set, toggle: () => set(resolve(pref) === 'dark' ? 'light' : 'dark') };
}
