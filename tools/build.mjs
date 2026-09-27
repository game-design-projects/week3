#!/usr/bin/env node
// Build the uploadable game: copy only runtime files into dist/.
// dist/ is a self-contained static site (index.html at the root, relative paths)
// — zip it or `butler push dist ...` to publish on itch.io.
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const RUNTIME = ['index.html', 'src', 'styles', 'assets', 'vendor'];

async function dirSize(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return { bytes: info.size, files: 1 };
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(path)) {
    const sub = await dirSize(join(path, entry));
    bytes += sub.bytes;
    files += sub.files;
  }
  return { bytes, files };
}

export async function build({ outDir = join(ROOT, 'dist') } = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const item of RUNTIME) {
    await cp(join(ROOT, item), join(outDir, item), {
      recursive: true,
      filter: (src) => !/\.test\.(m?js)$/.test(src) && !src.endsWith('.DS_Store'),
    });
  }
  const { bytes, files } = await dirSize(outDir);
  console.log(`[build] ${files} files, ${(bytes / 1024).toFixed(1)} KiB → ${outDir}`);
  return { outDir, bytes, files };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  build().catch((err) => {
    console.error('[build] failed:', err);
    process.exit(1);
  });
}
