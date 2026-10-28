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
      <div className="page-head"><div><Bar w="220px" h={26} /><div style={{ height: 10 }} /><Bar w="320px" /></div></div>
      <div className="card"><ListSkeleton /></div>
    </div>
  );
}

/** Mirrors the dashboard grid: four stat cards, then three panels. */
export function DashSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <div className="page-head"><div><Bar w="180px" h={26} /><div style={{ height: 10 }} /><Bar w="300px" /></div></div>
      <div className="dash">
        {['a-k1', 'a-k2', 'a-k3', 'a-k4'].map((c) => <div key={c} className={`${c} sk-card`} style={{ minHeight: 150 }}><Bar w="45%" /><Bar w="35%" h={34} /><Bar w="60%" /></div>)}
        {['a-an', 'a-re', 'a-pr'].map((c) => <div key={c} className={`${c} sk-card`} style={{ minHeight: 240 }}><Bar w="40%" /><span className="sk sk-fill" /></div>)}
      </div>
    </div>
  );
}

/** First paint while the session is restored. */
export function Boot() {
  return (
    <div className="boot" role="status" aria-label="Loading Taskify">
      <span className="boot-mark" aria-hidden="true">T</span>
      <span className="boot-track" aria-hidden="true"><i /></span>
    </div>
  );
}
