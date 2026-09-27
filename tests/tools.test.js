import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer } from '../tools/serve.mjs';
import { build } from '../tools/build.mjs';
import { APP_VERSION } from '../src/config.js';

async function withServer(root, fn) {
  const server = createStaticServer(root);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('serve: JS modules get a JavaScript MIME type (required for <script type=module>)', async () => {
  await withServer('.', async (base) => {
    const res = await fetch(`${base}/src/config.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
  });
});

test('serve: SVG pieces are served as image/svg+xml', async () => {
  await withServer('.', async (base) => {
    const res = await fetch(`${base}/assets/pieces/wK.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  });
});

test('serve: missing files 404 and path traversal is refused', async () => {
  await withServer('./src', async (base) => {
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
    const res = await fetch(`${base}/%2e%2e/package.json`);
    assert.ok([403, 404].includes(res.status), `got ${res.status}`);
  });
});

test('build: dist/ contains only runtime files, no tests', async () => {
  const out = await mkdtemp(join(tmpdir(), 'cbs-build-'));
  try {
    await build({ outDir: out });
    const top = (await readdir(out)).sort();
    assert.deepEqual(top, ['assets', 'index.html', 'src', 'styles', 'vendor']);
    const html = await readFile(join(out, 'index.html'), 'utf8');
    assert.match(html, /src\/main\.js/);
    assert.doesNotMatch(html, /(src|href)="\//, 'itch.io needs relative paths only');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('package.json version matches APP_VERSION', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.version, APP_VERSION);
});

test('vendored chess.js is byte-identical to the pinned devDependency', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const vendored = await readFile('vendor/chess.js');
  let pinned;
  try {
    pinned = await readFile('node_modules/chess.js/dist/esm/chess.js');
  } catch {
    return; // node_modules not installed (e.g. fresh clone without pnpm install) — skip
  }
  assert.equal(pkg.devDependencies['chess.js'], '1.4.0');
  assert.ok(vendored.equals(pinned), 'vendor/chess.js drifted from node_modules/chess.js');
});

test('board colours: a1 and h8 are dark, h1 and a8 light', async () => {
  const { isLight } = await import('../src/ui/board.js');
  assert.equal(isLight('a1'), false);
  assert.equal(isLight('h8'), false);
  assert.equal(isLight('h1'), true);
  assert.equal(isLight('a8'), true);
});
