import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'tt-theme';
let wipe: { skipTransition(): void } | null = null;
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

const read = (): ThemePref => {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
};
const resolve = (p: ThemePref) => (p === 'system' ? (media().matches ? 'dark' : 'light') : p);
const apply = (p: ThemePref) => { document.documentElement.dataset.theme = resolve(p); };

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
    const root = document.documentElement;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; skipTransition(): void } };
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // slow left-to-right wipe: the browser snapshots old and new themes and animates only a clip-path (see styles.css)
      wipe?.skipTransition();
      const t = doc.startViewTransition(() => flushSync(() => { apply(p); setPref(p); }));
      wipe = t;
      t.finished.finally(() => { if (wipe === t) wipe = null; });
    } else {
      root.classList.add('theme-anim'); // brief cross-fade; removed so normal hover transitions aren't slowed
      apply(p); setPref(p);
      setTimeout(() => root.classList.remove('theme-anim'), 450);
    }
    window.dispatchEvent(new Event('tt-theme'));
  };
  return { pref, theme: resolve(pref), set, toggle: () => set(resolve(pref) === 'dark' ? 'light' : 'dark') };
}
