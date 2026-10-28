// Production server for Render: serves the built SPA from dist/ and the api/ handlers on one port.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import invite from './api/invite';
import tick from './api/cron/tick';
import type { Req, Res } from './api/_lib/http';

const ROUTES: Record<string, (req: Req, res: Res) => Promise<void>> = { invite, 'cron/tick': tick };
const DIST = resolve('dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
};
const MAX_BODY = 1_000_000;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (code: number, body: string | Buffer, type = 'application/json', cache = 'no-store') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
    res.end(body);
  };

  if (url.pathname === '/healthz') return send(200, 'ok', 'text/plain');

  if (url.pathname.startsWith('/api/')) {
    const fn = ROUTES[url.pathname.slice(5).replace(/\/$/, '')];
    if (!fn) return send(404, JSON.stringify({ error: 'Not found' }));
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) return send(413, JSON.stringify({ error: 'Body too large' })); }
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { return send(400, JSON.stringify({ error: 'Invalid JSON' })); }
    const r: Res = { status(c) { res.statusCode = c; return r; }, json(o) { send(res.statusCode || 200, JSON.stringify(o)); } };
    try { await fn({ method: req.method, headers: req.headers, body, query: Object.fromEntries(url.searchParams) }, r); }
    catch (e) { console.error(e); if (!res.headersSent) send(500, JSON.stringify({ error: 'Server error' })); }
    return;
  }

  // static files, falling back to index.html for client-side routes
  const file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return send(400, 'Bad path', 'text/plain');
  try {
    if ((await stat(file)).isFile()) {
      const hashed = url.pathname.startsWith('/assets/');
      return send(200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
  } catch { /* not a file: fall through to the SPA */ }
  if (extname(url.pathname)) return send(404, 'Not found', 'text/plain');
  send(200, await readFile(join(DIST, 'index.html')), TYPES['.html'], 'no-cache');
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Taskify listening on ${port}`));
