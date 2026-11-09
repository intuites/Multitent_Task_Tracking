import { brandPalette } from '../lib/palette';

/** A small dashboard drawn in a color's light and dark palettes, so people see both modes before they save. */
export default function BrandPreview({ color, side }: { color: string; side?: boolean }) {
  return (
    <div className={`brand-preview${side ? ' os-preview' : ''}`} aria-label="Preview of the color in light and dark mode" role="img">
      {(['light', 'dark'] as const).map((m) => {
        const p = brandPalette(color, m);
        const vars = { '--b': p['--brand'], '--tint': p['--brand-tint'], '--grad': p['--brand-grad'], '--ink': p['--brand-ink'],
          '--bp-bg': p['--panel'], '--bp-fg': p['--text'], '--bp-muted': p['--muted'], '--bp-line': p['--line'] } as React.CSSProperties;
        return (
          <div key={m} className="bp" style={vars} aria-hidden="true">
            <small className="bp-mode">{m === 'light' ? 'Light mode' : 'Dark mode'}</small>
            <b className="bp-title">Quarterly planning</b>
            <span className="bp-nav">Dashboard</span>
            <span className="bp-kpi"><small>My open tasks</small><b>4</b></span>
            <span className="bp-row"><span className="bp-btn">Update status</span><span className="bp-link">View all</span></span>
            <span className="bp-bar"><i /></span>
          </div>);
      })}
    </div>
  );
}
