import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Local-only: serves ./api/*.ts handlers at /api/* so no Vercel CLI is needed during development.
function apiDev(): Plugin {
  return {
    name: 'api-dev',
    configureServer(server) {
      Object.assign(process.env, loadEnv('development', process.cwd(), ''));
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const file = url.pathname.slice(5).replace(/\/$/, '');
        // source modules the frontend imports (api/_lib/*.ts, anything with an extension) are served by Vite itself
        if (/\.\w+$/.test(file) || file.split('/').some((p) => p.startsWith('_'))) return next();
        if (!/^[a-z0-9/_-]+$/i.test(file)) { res.statusCode = 404; return res.end(); }
        const r = res as any, q = req as any;
        r.status = (c: number) => { res.statusCode = c; return r; };
        r.json = (o: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
        try {
          let raw = '';
          for await (const c of req) raw += c;
          q.body = raw ? JSON.parse(raw) : undefined;
          q.query = Object.fromEntries(url.searchParams);
          const mod = await server.ssrLoadModule(`/api/${file}.ts`);
          await mod.default(req, res);
        } catch (e) {
          console.error(e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Server error' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDev()],
  // libraries change rarely, so keep them in their own long-cached files; a deploy then only re-downloads app code
  build: { rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], supabase: ['@supabase/supabase-js'] } } } },
});
