// Brand palette generator: one picked color -> every brand token, separately for light and dark mode, with
// WCAG contrast guaranteed for each text pairing. The stylesheet only ever reads these tokens.

type Mode = 'light' | 'dark';
type Lch = [number, number, number]; // OKLCH: lightness 0..1, chroma, hue degrees

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
}
function rgbToLch([r, g, b]: [number, number, number]): Lch {
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
function lchToLinear([L, C, H]: Lch): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
/** OKLCH -> sRGB hex; chroma is reduced until the color fits the sRGB gamut, so hue and lightness are kept. */
function lchToHex([L, C, H]: Lch): string {
  let c = C, rgb = lchToLinear([L, c, H]);
  while (c > 0 && rgb.some((v) => v < -1e-4 || v > 1 + 1e-4)) { c = Math.max(0, c - 0.002); rgb = lchToLinear([L, c, H]); }
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, fromLin(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0')).join('');
}
const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG 2 contrast ratio between two hex colors (1..21). */
export function contrast(a: string, b: string) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

/** Step lightness from `start` toward `dir` (+1 lighter, -1 darker) until `ok` holds. */
function seek(lch: Lch, start: number, dir: 1 | -1, ok: (hex: string) => boolean): string {
  for (let L = start; L >= 0 && L <= 1; L += dir * 0.005) { const hex = lchToHex([L, lch[1], lch[2]]); if (ok(hex)) return hex; }
  return dir > 0 ? '#ffffff' : '#000000';
}
const mix = (a: string, b: string, t: number) => { // t of a, in OKLCH-ish via linear sRGB (fine for tints)
  const [x, y] = [hexToRgb(a).map(toLin), hexToRgb(b).map(toLin)];
  return '#' + x.map((v, i) => Math.round(fromLin(v * t + y[i] * (1 - t)) * 255).toString(16).padStart(2, '0')).join('');
};

const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
/** `fg` at opacity `a` painted over `back`, the way the browser composites it. */
export const over = (fg: string, a: number, back: string) => { const [x, y] = [hexToRgb(fg), hexToRgb(back)]; return toHex(x.map((v, i) => v * a + y[i] * (1 - a))); };

/** Frosted-glass top bar: a brand-tinted frost at the lowest opacity that keeps the bar's text readable over anything
 *  that scrolls under it (the page, cards, and the brand's solid fill). Returns the frost color and its opacity. */
export function glassBar(o: { tint: string; surface: string; bg: string; solid: string; text: string; muted: string; dark: boolean }) {
  const frost = mix(o.tint, o.dark ? o.surface : '#ffffff', o.dark ? 0.55 : 0.4);
  const ok = (a: number) => [o.bg, o.surface].every((b) => contrast(o.text, over(frost, a, b)) >= 7 && contrast(o.muted, over(frost, a, b)) >= 4.5)
    && contrast(o.text, over(frost, a, o.solid)) >= 4.5;
  let a = o.dark ? 0.5 : 0.45;
  while (a < 0.97 && !ok(a)) a = Math.round((a + 0.01) * 100) / 100;
  return { frost, alpha: a };
}
const rgba = (hex: string, a: number) => `rgb(${hexToRgb(hex).map((v) => Math.round(v * 255)).join(' ')} / ${a})`;

const SURFACE: Record<Mode, { surface: string; bg: string }> = { light: { surface: '#ffffff', bg: '#eceeed' }, dark: { surface: '#212224', bg: '#161718' } };
const INK_DARK = '#111214';

export type Palette = Record<string, string>;

/** Every brand token for one mode. Values are plain hex/gradients, so every browser gets the same result. */
export function brandPalette(hex: string, mode: Mode): Palette {
  const base = rgbToLch(hexToRgb(hex));
  const { surface, bg } = SURFACE[mode];
  const dark = mode === 'dark';
  const hueC = Math.min(base[1], 0.19);
  const tone: Lch = [base[0], base[1], base[2]];

  // solid fill (buttons, active tabs, main card): the exact color when it works; otherwise nudged until it stands
  // out from the page (3:1, WCAG non-text) and some text color reads on it (4.5:1)
  let solid = hex;
  const ink = (s: string) => (contrast(s, '#ffffff') >= contrast(s, INK_DARK) ? '#ffffff' : INK_DARK);
  const solidOk = (s: string) => contrast(s, bg) >= (dark ? 3 : 1.6) && contrast(s, ink(s)) >= 4.5;
  if (!solidOk(solid)) {
    const up = dark ? seek(tone, tone[0], 1, solidOk) : null, down = seek(tone, tone[0], -1, solidOk);
    solid = dark && up && up !== '#ffffff' ? up : down;
  }
  const onSolid = ink(solid);
  // the gradient goes away from the ink color so text keeps its contrast across the whole fill
  const sl = rgbToLch(hexToRgb(solid));
  const solidEnd = lchToHex([Math.min(1, Math.max(0, sl[0] + (onSolid === '#ffffff' ? -0.09 : 0.06))), sl[1], sl[2]]);

  // brand text on surfaces: 4.5:1 (links, headings in brand color); strong brand text 7:1
  const textOk = (r: number) => (s: string) => contrast(s, surface) >= r && contrast(s, bg) >= r - 0.3;
  const text = seek([dark ? 0.72 : 0.5, hueC, base[2]], dark ? 0.72 : 0.5, dark ? 1 : -1, textOk(4.6));
  const strong = seek([dark ? 0.82 : 0.38, hueC, base[2]], dark ? 0.82 : 0.38, dark ? 1 : -1, textOk(7.5));
  // decorative tone at the default green's lightness (glows, hero art, washes): never text on its own
  const accentN = lchToHex([0.53, hueC, base[2]]);
  // tints sit at a fixed lightness so a bright pick (yellow) never glares and a dark one never vanishes
  const tintAt = (L: number, cap: number) => lchToHex([L, Math.min(hueC, cap), base[2]]);
  const tint = dark ? tintAt(0.3, 0.05) : tintAt(0.955, 0.04);
  const neutral = (L: number) => lchToHex([L, Math.min(hueC, 0.012), base[2]]);

  const p: Palette = {
    '--accent': hex, '--accent-n': accentN,
    '--brand': text, '--link': text, '--brand-deep': strong,
    '--brand-2': solid, '--brand-3': mix(solid, surface, 0.55),
    '--brand-ink': onSolid, '--brand-ink-muted': mix(onSolid, solid, 0.82),
    // brand text on the white chips and round buttons that sit on brand art, in both modes
    '--brand-on-white': seek([0.45, hueC, base[2]], 0.45, -1, (s) => contrast(s, '#ffffff') >= 4.6),
    '--brand-grad': `linear-gradient(135deg, ${solid} 0%, ${solidEnd} 100%)`,
    '--brand-tint': tint,
    '--ok-bg': dark ? tintAt(0.31, 0.06) : tintAt(0.95, 0.05), '--ok-fg': text, '--ok-line': dark ? tintAt(0.4, 0.07) : tintAt(0.86, 0.07),
  };
  // dark restates every neutral the light block sets (both blocks match in dark mode)
  if (dark) Object.assign(p, {
    '--bg': '#161718', '--panel': '#1c1d1f', '--surface-2': '#28292c', '--line': '#323438', '--control-line': '#575a5f',
    '--text': neutral(0.93), '--muted': neutral(0.72), '--neutral-bg': '#2a2b2e', '--neutral-fg': neutral(0.82), '--neutral-line': '#383a3e', '--hatch': '#4e5054',
  });
  else Object.assign(p, {
    '--bg': neutral(0.94), '--panel': neutral(0.978), '--surface-2': neutral(0.965), '--line': neutral(0.925), '--control-line': neutral(0.66),
    '--text': neutral(0.2), '--muted': neutral(0.53), '--neutral-bg': neutral(0.955), '--neutral-fg': neutral(0.38), '--neutral-line': neutral(0.9), '--hatch': neutral(0.74),
  });
  const bar = glassBar({ tint, surface, bg: p['--bg'], solid, text: p['--text'], muted: p['--muted'], dark });
  p['--bar-bg'] = rgba(bar.frost, bar.alpha);
  return p;
}

/** The stylesheet for an organization's color: light tokens, then dark tokens. */
export function brandCss(hex: string) {
  const block = (sel: string, p: Palette) => `${sel}{${Object.entries(p).map(([k, v]) => `${k}:${v}`).join(';')}}`;
  // doubled :root outranks the stylesheet's own token blocks wherever this <style> sits in <head>
  return block(':root:root[data-brand]', brandPalette(hex, 'light')) + block(':root:root[data-brand][data-theme="dark"]', brandPalette(hex, 'dark'));
}
