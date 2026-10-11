import { chromium } from '@playwright/test';
import { realpath, mkdir, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute } from 'node:path';

if (process.env.CI) throw new Error('Screenshots are local-only; do not upload them as CI artifacts.');
const requested = resolve(homedir(), 'Website-LocalDocs');
if ((await lstat(requested)).isSymbolicLink()) throw new Error('Private documentation directory must not be a symlink.');
const docs = await realpath(requested);
const repo = await realpath(process.cwd());
const within = relative(repo, docs);
if (!within || (!within.startsWith('..') && !isAbsolute(within))) throw new Error('Private screenshots must be outside Git.');
const destination = resolve(docs, 'screenshots');
try {
  if ((await lstat(destination)).isSymbolicLink()) throw new Error('Screenshot directory must not be a symlink.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(destination, { recursive: true, mode: 0o700 });
const browser = await chromium.launch();
try {
  for (const theme of ['dark', 'light']) {
    for (const width of [390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addInitScript(mode => localStorage.setItem('built-signal-theme', mode), theme);
      const page = await context.newPage();
      for (const route of ['/', '/about/', '/writing/', '/writing/sample/', '/writing/archive/', '/projects/', '/lab/', '/mentorship/', '/contact/', '/missing-page/']) {
        await page.goto(`http://127.0.0.1:4321${route}`);
        await page.locator('h1').waitFor();
        const name = route === '/' ? 'home' : route.replaceAll('/', '-').replace(/^-|-$/g, '');
        await page.screenshot({ path: resolve(destination, `${name}-${theme}-${width}.png`), fullPage: true });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Private screenshots saved in ${destination}`);
