// Loading placeholders shaped like the content they stand in for, so the page doesn't jump when data lands.
const Bar = ({ w, h = 12 }: { w: string; h?: number }) => <span className="sk" style={{ width: w, height: h }} />;
const WIDTHS = ['38%', '22%', '16%', '12%'];

/** Table/list rows; drop it where the list will render. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="sk-list" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row" style={{ animationDelay: `${i * 60}ms` }}>
          {WIDTHS.map((w, j) => <Bar key={j} w={j === 0 ? `${30 + ((i * 7) % 18)}%` : w} />)}
        </div>
      ))}
    </div>
  );
}

/** Whole-page placeholder: heading plus a content card. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <span className="sk-progress" aria-hidden="true" />
      <div className="page-head"><div><Bar w="220px" h={26} /><div style={{ height: 10 }} /><Bar w="320px" /></div></div>
      <div className="card sk-card"><ListSkeleton /></div>
    </div>
  );
}

/** Mirrors the dashboard grid: four stat cards, then three panels. */
export function DashSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <span className="sk-progress" aria-hidden="true" />
      <div className="page-head"><div><Bar w="180px" h={26} /><div style={{ height: 10 }} /><Bar w="300px" /></div></div>
      <div className="db">
        <div className="db-stats sk-card" style={{ minHeight: 112 }}><Bar w="40%" /><Bar w="25%" h={30} /></div>
        <div className="db-chart sk-card" style={{ minHeight: 300 }}><Bar w="30%" /><span className="sk sk-fill" /></div>
        <div className="db-aside"><div className="sk-card" style={{ minHeight: 140 }}><Bar w="50%" /><Bar w="80%" /></div><div className="sk-card" style={{ minHeight: 140 }}><Bar w="40%" /><span className="sk sk-fill" /></div></div>
      </div>
    </div>
  );
}

/** First paint while the session is restored. */
export function Boot() {
  return (
    <div className="boot" role="status" aria-label="Loading Taskify">
      <span className="boot-blob b1" aria-hidden="true" /><span className="boot-blob b2" aria-hidden="true" />
      <span className="boot-logo" aria-hidden="true"><span className="boot-ring" /><span className="boot-mark">T</span></span>
      <b className="boot-name">Taskify</b>
      <span className="boot-track" aria-hidden="true"><i /></span>
      <small className="boot-note">Getting your workspace ready…</small>
    </div>
  );
}
