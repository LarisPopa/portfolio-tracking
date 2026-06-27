import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Yahoo Finance's `query{1,2}.finance.yahoo.com` endpoint rate-limits clients
// hard, and the rules are quirky: a `Mozilla/5.0 ...` UA gets 429'd while a
// minimal "node" UA passes (probably anti-scraping fingerprinting in reverse).
// We use a small middleware over Node's global `fetch` instead of Vite's
// built-in `server.proxy` so the upstream request is fully under our control.
function yahooProxy(): Plugin {
  return {
    name: 'yahoo-proxy',
    configureServer(server) {
      server.middlewares.use('/yahoo', async (req, res) => {
        const target = `https://query2.finance.yahoo.com${req.url ?? ''}`;
        try {
          const upstream = await fetch(target, {
            // Counterintuitively, Yahoo throttles "Mozilla/5.0..." much more
            // aggressively than minimal/automation UAs. A plain "node" UA
            // currently passes; if that ever changes, try removing the UA
            // entirely or substituting another short token.
            headers: {
              'User-Agent': 'node',
              Accept: 'application/json,text/plain,*/*',
            },
          });
          const body = await upstream.text();
          res.statusCode = upstream.status;
          const ct = upstream.headers.get('content-type');
          if (ct) res.setHeader('content-type', ct);
          res.end(body);
        } catch (e) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: String((e as Error)?.message ?? e) }));
        }
      });
    },
  };
}

export default defineConfig({
  // When building in GitHub Actions the app is served from a sub-path.
  // Locally (dev server) we leave base as '/' so nothing changes.
  base: process.env.GITHUB_ACTIONS ? '/portfolio-tracking/' : '/',
  plugins: [react(), yahooProxy()],
  server: { port: 5173 },
});
