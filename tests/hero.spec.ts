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
  await expect(overlay.locator('path')).toHaveCount(14);
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
