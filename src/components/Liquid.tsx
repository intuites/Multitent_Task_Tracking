import { useEffect, useId, useState } from 'react';

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slow "metaball" liquid: blurred circles drift and a threshold filter fuses them into one organic shape.
 * Shapes are opaque inside the filter; the group's opacity (CSS) keeps the result a soft tint.
 */
export function LiquidBg({ tone = 'light' }: { tone?: 'light' | 'deep' }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const goo = (
    <filter id={`goo${id}`} x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur" />
      <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" />
    </filter>
  );
  return (
    <svg className={`liquid liquid-${tone}`} viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>{goo}</defs>
      <g className="liquid-a" filter={`url(#goo${id})`}>
        <circle className="drop d1" cx="300" cy="190" r="74" />
        <circle className="drop d2" cx="370" cy="120" r="52" />
        <circle className="drop d3" cx="220" cy="230" r="60" />
      </g>
      <g className="liquid-b" filter={`url(#goo${id})`}>
        <circle className="drop d4" cx="80" cy="-10" r="58" />
        <circle className="drop d5" cx="150" cy="30" r="34" />
      </g>
    </svg>
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

export const CountUp = ({ value }: { value: number }) => <>{useCountUp(value)}</>;
