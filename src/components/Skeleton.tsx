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
      <div className="dash">
        {['a-k1', 'a-k2', 'a-k3', 'a-k4'].map((c) => <div key={c} className={`${c} sk-card`} style={{ minHeight: 150 }}><Bar w="45%" /><Bar w="35%" h={34} /><Bar w="60%" /></div>)}
        {['a-an', 'a-re'].map((c) => <div key={c} className={`${c} sk-card`} style={{ minHeight: 240 }}><Bar w="40%" /><span className="sk sk-fill" /></div>)}
      </div>
    </div>
  );
}

/** First paint while the session is restored. */
export function Boot() {
  return (
    <div className="boot" role="status" aria-label="Loading Taskify">
      <span className="boot-blob b1" aria-hidden="true" /><span className="boot-blob b2" aria-hidden="true" />
      {/* an admin hands a task card to an employee, who works on it (bars fill) and hands it back */}
      <svg className="boot-scene" viewBox="0 0 280 136" aria-hidden="true">
        <line className="bs-floor" x1="16" y1="118" x2="264" y2="118" />
        <g className="bs-admin">
          <circle className="bs-head" cx="50" cy="44" r="12" />
          <path className="bs-body bs-a" d="M30 118v-32a20 20 0 0 1 40 0v32z" />
        </g>
        <g className="bs-emp">
          <g className="bs-nod"><circle className="bs-head" cx="230" cy="44" r="12" /></g>
          <path className="bs-body bs-e" d="M210 118v-32a20 20 0 0 1 40 0v32z" />
          <g className="bs-dots"><circle cx="222" cy="22" r="2.2" /><circle cx="230" cy="22" r="2.2" /><circle cx="238" cy="22" r="2.2" /></g>
        </g>
        <g className="bs-card">
          <rect className="bs-paper" x="72" y="70" width="36" height="28" rx="6" />
          <rect className="bs-line" x="79" y="78" width="22" height="3.5" rx="1.75" />
          <rect className="bs-line" x="79" y="86" width="15" height="3.5" rx="1.75" />
          <rect className="bs-fill f1" x="79" y="78" width="22" height="3.5" rx="1.75" />
          <rect className="bs-fill f2" x="79" y="86" width="15" height="3.5" rx="1.75" />
        </g>
        <text className="bs-tag" x="50" y="132">Admin</text>
        <text className="bs-tag" x="230" y="132">Employee</text>
      </svg>
      <b className="boot-name">Taskify</b>
      <span className="boot-track" aria-hidden="true"><i /></span>
      <small className="boot-note">Getting your workspace ready…</small>
    </div>
  );
}
