import { useLayoutEffect, useRef, useState } from 'react';

/** The raised highlight behind the selected tab, sliding to it when the selection changes (stageshow's segmented control).
 *  Put it as the first child of a tab bar; it finds the selected tab itself ([aria-selected=true], [aria-pressed=true] or .on). */
export default function TabThumb() {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const bar = ref.current?.parentElement;
    if (!bar) return;
    const place = () => {
      const on = bar.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"], .on');
      setBox((b) => {
        const next = on ? { x: on.offsetLeft, w: on.offsetWidth } : null;
        return b && next && b.x === next.x && b.w === next.w ? b : next;
      });
    };
    place();
    // the selection, a count in a tab, the font or the text size can all move the tabs
    const mo = new MutationObserver(place);
    mo.observe(bar, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'class'], childList: true, characterData: true });
    const ro = new ResizeObserver(place);
    ro.observe(bar);
    return () => { mo.disconnect(); ro.disconnect(); };
  }, []);
  return <span ref={ref} className="tab-thumb" aria-hidden="true" style={box ? { transform: `translateX(${box.x}px)`, width: box.w } : { opacity: 0 }} />;
}
