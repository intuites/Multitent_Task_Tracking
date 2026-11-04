import { describe, expect, it } from 'vitest';
import { brandPalette, contrast, glassBar, over } from './palette';
import { ALL_PRESETS } from './brandColors';

// every preset admins can pick, plus edge cases
const COLORS = [...new Set([...ALL_PRESETS, '#000000', '#333333', '#777777', '#bbbbbb', '#ffffff', '#fff3a0', '#ffd400', '#a3e635', '#22d3ee', '#1e1b4b'])];
const SURFACE = { light: '#ffffff', dark: '#212224' } as const;
const BG = { light: '#eceeed', dark: '#161718' } as const;

describe('brand palette', () => {
  for (const mode of ['light', 'dark'] as const) for (const c of COLORS) {
    it(`${c} in ${mode} mode is readable`, () => {
      const p = brandPalette(c, mode);
      expect(contrast(p['--brand'], SURFACE[mode])).toBeGreaterThanOrEqual(4.5); // brand text and links
      expect(contrast(p['--brand-deep'], SURFACE[mode])).toBeGreaterThanOrEqual(7); // strong brand text
      expect(contrast(p['--brand-ink'], p['--brand-2'])).toBeGreaterThanOrEqual(4.5); // text on buttons
      expect(contrast(p['--brand-2'], BG[mode])).toBeGreaterThanOrEqual(mode === 'dark' ? 3 : 1.6); // button stands out
      expect(contrast(p['--brand-on-white'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p['--text'], SURFACE[mode])).toBeGreaterThanOrEqual(7);
      expect(contrast(p['--muted'], SURFACE[mode])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p['--brand-deep'], p['--brand-tint'])).toBeGreaterThanOrEqual(4.5); // numbers on brand-tint chips (org settings)
      // glass top bar: readable over the page, a card, or the brand fill scrolling under it, and still see-through
      const [, r, g, b, a] = p['--bar-bg'].match(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/)!.map(Number);
      const frost = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      expect(a).toBeLessThanOrEqual(0.75);
      for (const back of [p['--bg'], SURFACE[mode]]) {
        expect(contrast(p['--text'], over(frost, a, back))).toBeGreaterThanOrEqual(7);
        expect(contrast(p['--muted'], over(frost, a, back))).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(p['--text'], over(frost, a, p['--brand-2']))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the default bar glass in styles.css matches the generator for Taskify green', () => {
    expect(glassBar({ tint: '#e8f5ee', surface: '#ffffff', bg: '#eceeed', solid: '#2e7d4f', text: '#121a16', muted: '#66726b', dark: false })).toEqual({ frost: '#f6fbf8', alpha: 0.45 });
    expect(glassBar({ tint: '#15301f', surface: '#212224', bg: '#161718', solid: '#2e7d4f', text: '#e5ede8', muted: '#92a299', dark: true })).toEqual({ frost: '#1b2a21', alpha: 0.5 });
  });
  it('keeps the exact color on buttons when it already works', () => {
    expect(brandPalette('#2563eb', 'light')['--brand-2']).toBe('#2563eb');
    expect(brandPalette('#ffd400', 'dark')['--brand-2']).toBe('#ffd400');
    expect(brandPalette('#ffd400', 'dark')['--brand-ink']).not.toBe('#ffffff'); // dark text on yellow
  });
});
