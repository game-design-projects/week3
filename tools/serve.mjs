#!/usr/bin/env node
// Zero-dependency static file server for local play and playtests.
//   pnpm dev                 -> http://localhost:5173
//   PORT=8080 pnpm dev
//   node tools/serve.mjs dist   (serve the itch.io build instead of the source tree)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function createStaticServer(rootDir) {
  const root = resolve(rootDir);
  return createServer(async (req, res) => {
    const started = Date.now();
    let status = 200;
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(root, rel));
      if (file !== root && !file.startsWith(root + sep)) {
        status = 403;
        res.writeHead(status).end('Forbidden');
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info || !info.isFile()) {
        status = 404;
        res.writeHead(status, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const body = await readFile(file);
      res.writeHead(status, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      status = 500;
      res.writeHead(status).end(String(err));
    } finally {
      if (process.env.CBS_LOG === 'debug' || status >= 400) {
        console.log(`[serve] ${status} ${req.method} ${req.url} ${Date.now() - started}ms`);
      }
    }
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = process.argv[2] ?? '.';
  const port = Number(process.env.PORT ?? 5173);
  createStaticServer(root).listen(port, () => {
    console.log(`[serve] Chess Battle Simulator → http://localhost:${port}/  (root: ${resolve(root)})`);
  });
}
