import { Count } from '../stageshow/kit/motion';
import { useEffect, useState } from 'react';

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slow drifting "liquid" light. Soft gradient blobs moved only with transform, so the GPU composites them
 * without re-rasterizing every frame (the earlier SVG blur filter was far heavier on memory).
 */
export function LiquidBg({ tone = 'light' }: { tone?: 'light' | 'deep' }) {
  return (
    <div className={`liquid liquid-${tone}`} aria-hidden="true">
      <span className="blob b1" /><span className="blob b2" /><span className="blob b3" /><span className="blob b4" />
    </div>
  );
}

/** Counts from 0 to the target with an ease-out curve; jumps straight there when motion is reduced. */
export function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) { setV(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 4))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** A figure that rolls up from 0 when it first shows, then rolls to each new value (stageshow's Count). */
export function CountUp({ value }: { value: number }) {
  const [v, setV] = useState(() => (reducedMotion() ? value : 0));
  useEffect(() => { const id = requestAnimationFrame(() => setV(value)); return () => cancelAnimationFrame(id); }, [value]);
  return <Count value={v} />;
}
