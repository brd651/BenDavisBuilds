import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
const sample = resolve('dist/writing/sample/index.html');
if (!existsSync(sample)) throw new Error('Build the site before measuring JavaScript.');
function htmlFiles(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? htmlFiles(resolve(directory, entry.name)) : entry.name.endsWith('.html') ? [resolve(directory, entry.name)] : []); }
for (const file of htmlFiles(resolve('dist'))) {
  const html = readFileSync(file,'utf8');
  if (!/class="publishing-article(?:"|\s)/.test(html)) continue;
  const assets = new Set(); let bytes = 0;
  for (const [, attributes, content] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/type="application\/ld\+json"/.test(attributes)) continue;
    const src = attributes.match(/src="([^"]+)"/);
    if (src) { if (!src[1].startsWith('/')) throw new Error(`Unexpected external script ${src[1]}`); assets.add(src[1]); } else bytes += gzipSync(content).length;
  }
  // Count static imports once. Optional dynamic imports are measured separately.
  for (const asset of assets) {
    const source = readFileSync(resolve('dist',asset.slice(1)),'utf8'); bytes += gzipSync(source).length;
    if (/react-dom|react\/jsx-runtime/.test(source)) throw new Error(`Unexpected React payload in ${file}`);
    for (const [, imported] of source.matchAll(/(?:from\s*|import\s*)["']([^"']+\.js)["']/g)) assets.add(new URL(imported,`https://example.invalid${asset}`).pathname);
  }
  console.log(`${file.replace(resolve('dist'),'')}: ${bytes} gzip bytes initial JavaScript (inline + shared + static imports)`);
  if (bytes > 15*1024) throw new Error('Reading page JavaScript exceeds 15 KiB gzip.');
}
