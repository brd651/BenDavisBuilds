import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const file = resolve('dist/writing/sample/index.html');
if (!existsSync(file)) throw new Error('Build the site before measuring JavaScript.');
const html = readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const assets = new Set();
let bytes = 0;
for (const [, attributes, content] of scripts) {
  const src = attributes.match(/src="([^"]+)"/);
  if (src) {
    if (!src[1].startsWith('/')) throw new Error(`Unexpected external script ${src[1]}`);
    assets.add(src[1]);
  } else bytes += gzipSync(content).length;
}
// Follow any bundled imports, counting shared modules once.
for (const asset of assets) {
  const source = readFileSync(resolve('dist', asset.slice(1)), 'utf8');
  bytes += gzipSync(source).length;
  for (const [, imported] of source.matchAll(/(?:from\s*|import\s*)["']([^"']+\.js)["']/g)) {
    const resolved = new URL(imported, `https://example.invalid${asset}`).pathname;
    assets.add(resolved);
  }
}
console.log(`Reading page first-party JavaScript: ${bytes} gzip bytes (inline + shared assets)`);
if (bytes > 15 * 1024) throw new Error('Reading page JavaScript exceeds 15 KiB gzip.');
