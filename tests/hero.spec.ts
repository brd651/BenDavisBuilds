import { test, expect } from '@playwright/test';

declare global { interface Window { heroLayoutShift: number } }

test('hero copy, actions and focus labels stay selectable HTML', async ({ page, request }) => {
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Systems for a more interesting tomorrow.' });
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Systems for a more interesting tomorrow.');
  await expect(hero.getByText('Technical leadership, practical systems, and real-world progress.')).toBeVisible();
  for (const [name, href] of [['Explore Writing', '/writing/'], ['View Projects', '/projects/']]) {
    const link = hero.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await link.focus();
    expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    expect((await request.get(href)).status()).toBe(200);
  }
  await expect(hero.getByLabel('Built Signal focus')).toContainText('PeopleSystemsExecutionImpact');
  // The design reference must never be published or loaded as scenery.
  expect(await page.locator('img').evaluateAll(images => images.some(img => img instanceof HTMLImageElement && img.currentSrc.includes('hero-reference.png')))).toBe(false);
  expect((await page.request.get('/design/reference/hero-reference.png')).status()).toBe(404);
});

test('contours have slow traveling highlights, a pause control and a reduced-motion fallback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const overlay = page.locator('.topographic-overlay');
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  expect(await overlay.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await expect(overlay.locator('.contours path')).toHaveCount(14);
  await expect(overlay.locator('.map-guides, .registration')).toHaveCount(2);
  await expect(overlay.locator('.contour-highlight')).toHaveCount(2);
  const durations = await overlay.locator('.contour-highlight').evaluateAll(paths => paths.map(path => Number.parseFloat(getComputedStyle(path).animationDuration)));
  expect(durations.every(seconds => seconds >= 20 && seconds <= 35)).toBe(true);
  await page.getByLabel('Pause contour motion').check();
  expect(await overlay.locator('.contour-highlight').first().evaluate(el => getComputedStyle(el).animationPlayState)).toBe('paused');
  await page.getByLabel('Pause contour motion').uncheck();
  expect(await overlay.locator('.contour-highlight').first().evaluate(el => getComputedStyle(el).animationPlayState)).toBe('running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await overlay.locator('.contour-highlight').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await expect(page.getByText('Motion off (system preference)')).toBeVisible();
});

test('homepage search filters real pages and Escape returns keyboard focus', async ({ page }) => {
  await page.goto('/');
  const search = page.getByLabel('Search this site');
  await search.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Search pages').fill('simulated');
  await expect(page.locator('.homepage-search li:visible')).toHaveCount(1);
  await expect(page.locator('.homepage-search').getByRole('link', { name: 'Lab', exact: true })).toHaveAttribute('href', '/lab/');
  await page.getByLabel('Search pages').fill('no-matching-page');
  await expect(page.locator('.search-count')).toHaveText('0 pages found.');
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(page.locator('.homepage-search')).not.toHaveAttribute('open');
  await page.goto('/about/');
  await expect(page.locator('.homepage-search, .topographic-overlay')).toHaveCount(0);
});

test('without JavaScript search navigation and motion pause still work', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'no-preference' });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4321/');
    await page.getByLabel('Search this site').click();
    await expect(page.locator('.homepage-search').getByRole('link', { name: 'Writing', exact: true })).toBeVisible();
    await expect(page.getByLabel('Search pages')).toBeHidden();
    await page.getByLabel('Pause contour motion').check();
    expect(await page.locator('.contour-highlight').first().evaluate(el => getComputedStyle(el).animationPlayState)).toBe('paused');
  } finally { await context.close(); }
});


test('homepage reserves appearance-control space while browser utilities load', async ({ page }) => {
  await page.addInitScript(() => {
    window.heroLayoutShift = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!shift.hadRecentInput) window.heroLayoutShift += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  // Astro inlines these small utilities as modules; delay the actual module bodies.
  await page.route('http://127.0.0.1:4321/', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/<script type="module">([\s\S]*?)<\/script>/g,
      (_, code: string) => `<script type="module">setTimeout(() => {${code}}, 350);</script>`);
    await route.fulfill({ response, body });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('Appearance')).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => window.heroLayoutShift)).toBeLessThan(0.01);
});


test('hero uses responsive artwork and open HUD framing', async ({ page }) => {
  await page.goto('/');
  const picture = page.locator('.hero-background picture');
  await expect(picture.locator('source[type="image/avif"]:not([media])')).toHaveAttribute('srcset', /640w.*960w.*1280w/);
  await expect(picture.locator('source[type="image/webp"]:not([media])')).toHaveAttribute('srcset', /640w.*960w.*1280w/);
  const image = picture.locator('img');
  expect(await image.evaluate(el => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(image).toHaveAttribute('width', '3840');
  await expect(image).toHaveAttribute('height', '2160');
  expect(await page.locator('.hero-hud').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
  await expect(page.locator('.hero-hud-frame')).toBeVisible();
  await expect(page.getByText('Temporary landscape illustration', { exact: false })).toHaveCount(0);
});


for (const [width, height, density] of [[2560, 1440, 1], [2560, 1440, 1.5], [3840, 2160, 1], [1920, 1080, 2]]) {
  test(`large hero preserves scene at ${width}px and ${density}x density`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: density });
    try {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:4321/');
      const image = page.locator('.hero-background img');
      await image.evaluate(async el => { if (el instanceof HTMLImageElement) await el.decode(); });
      const framing = await image.evaluate(el => {
        if (!(el instanceof HTMLImageElement)) throw new Error('Hero image missing');
        const box = el.getBoundingClientRect();
        const scale = Math.max(box.width / el.width, box.height / el.height);
        const drawn = { width: el.width * scale, height: el.height * scale };
        // Wide view is centered horizontally and top-aligned; landmarks are normalized source coordinates.
        const landmark = (x: number, y: number) => ({ x: x * drawn.width - (drawn.width - box.width) / 2, y: y * drawn.height });
        return { width: box.width, height: box.height, encodedWidth: el.width, source: el.currentSrc,
          position: getComputedStyle(el).objectPosition, points: [landmark(.287, .165), landmark(.79, .32), landmark(.79, .745)] };
      });
      expect(framing.width).toBeLessThanOrEqual(framing.encodedWidth);
      expect(framing.position).toBe('50% 0%');
      for (const point of framing.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(framing.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(framing.height);
      }
      if (width * density >= 3840) {
        const srcset = await page.locator('source[type="image/avif"][media]').getAttribute('srcset');
        const largest = srcset?.split(',').find(candidate => candidate.trim().endsWith('3840w'))?.trim().split(' ')[0];
        expect(framing.source).toBe(new URL(largest!, page.url()).href);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
  });
}
