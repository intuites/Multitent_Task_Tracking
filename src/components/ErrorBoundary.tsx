import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

const KEY = 'tt-chunk-reload';
// After a deploy the old page files are gone, so a tab opened before it fails to load the next page.
const isStaleChunk = (e: unknown) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Unable to preload CSS/i.test(String((e as Error)?.message ?? e));

/** Reload once (not in a loop) to pick up the new build. */
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage blocked: still reload once */ }
  window.location.reload();
  return true;
}

/** Shows a recovery card instead of a blank screen when something on the page throws. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown) {
    if (isStaleChunk(error)) reloadForNewBuild();
    else console.error(error);
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    // navigating away clears the error so the next page gets a fresh try
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = isStaleChunk(this.state.error);
    return (
      <div className="card crash" role="alert">
        <h2>{stale ? 'Taskify was just updated' : 'Something went wrong on this page'}</h2>
        <p className="muted">{stale ? 'Reload to get the latest version. Nothing you saved is lost.' : 'Reload the page to try again. If it keeps happening, tell your admin what you were doing.'}</p>
        <button type="button" onClick={() => window.location.reload()}><RefreshCw size={16} aria-hidden="true" />Reload</button>
      </div>
    );
  }
}
