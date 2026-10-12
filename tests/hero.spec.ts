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
  await expect(overlay.locator('.contours path')).toHaveCount(24);
  await expect(overlay.locator('.map-guides, .registration')).toHaveCount(2);
  await expect(overlay.locator('.contour-highlight')).toHaveCount(4);
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


for (const [width, height, density] of [[2560, 1440, 1], [2560, 1320, 1.5], [3840, 2160, 1], [3840, 2040, 1], [1920, 960, 2]]) {
  test(`large hero preserves scene at ${width}×${height}px and ${density}x density`, async ({ browser }) => {
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
        // Account for object-position when checking mountain peak and hiker head/feet.
        const [horizontal, vertical] = getComputedStyle(el).objectPosition.split(' ').map(Number.parseFloat);
        const landmark = (x: number, y: number) => ({ x: x * drawn.width - (drawn.width - box.width) * horizontal! / 100,
          y: y * drawn.height - (drawn.height - box.height) * vertical! / 100 });
        return { width: box.width, height: box.height, encodedWidth: el.width, source: el.currentSrc,
          position: getComputedStyle(el).objectPosition, points: [landmark(.287, .165), landmark(.79, .32), landmark(.79, .745)] };
      });
      expect(framing.width).toBeLessThanOrEqual(framing.encodedWidth);
      // The complete hero, including bottom labels and controls, fits below the header.
      const heroBox = await page.locator('.built-hero').boundingBox();
      expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(height + 1);
      const shells = await page.locator('.homepage-header, .hero-inner, .homepage-main > .shell, .site-footer').evaluateAll(elements =>
        elements.map(el => { const box = el.getBoundingClientRect(); return { x: box.x, width: box.width }; }));
      for (const shell of shells) {
        expect(Math.abs(shell.x - shells[0]!.x)).toBeLessThan(1);
        expect(Math.abs(shell.width - shells[0]!.width)).toBeLessThan(1);
      }
      for (const point of framing.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(framing.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(framing.height);
      }
      if (width * density >= 3840) {
        const srcset = await page.locator('source[type="image/avif"]:not([media])').getAttribute('srcset');
        const largest = srcset?.split(',').find(candidate => candidate.trim().endsWith('3840w'))?.trim().split(' ')[0];
        expect(framing.source).toBe(new URL(largest!, page.url()).href);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
  });
}


test('desktop resizing has no layout jumps at former image and wide-layout thresholds', async ({ page }) => {
  await page.goto('/');
  for (const theme of ['dark', 'light']) {
    await page.getByLabel('Appearance').selectOption(theme);
    for (const breakpoint of [1400, 1800, 1920, 2560]) {
      const frames = [];
      for (const width of [breakpoint - 1, breakpoint, breakpoint + 1]) {
        await page.setViewportSize({ width, height: 1080 });
        frames.push(await page.locator('.homepage-header, .hero-inner, .hero-foreground, .hero-hud, .hero-bottom, h1').evaluateAll(elements =>
          elements.map(el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })));
      }
      for (let frame = 1; frame < frames.length; frame++) for (let element = 0; element < frames[frame]!.length; element++) {
        const before = frames[frame - 1]![element]!;
        const after = frames[frame]![element]!;
        for (const dimension of ['x', 'y', 'width', 'height'] as const)
          expect(Math.abs(after[dimension] - before[dimension]), `${theme} ${breakpoint}px element ${element} ${dimension}`).toBeLessThan(3);
      }
    }
  }
});

test('4K homepage type scales with the shell while reading pages retain their size', async ({ page }) => {
  const sizes: number[] = [];
  for (const width of [1440, 1920, 2560, 3840]) {
    await page.setViewportSize({ width, height: 2160 });
    await page.goto('/');
    sizes.push(await page.locator('h1').evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize)));
  }
  expect(sizes[3]!).toBeGreaterThan(sizes[0]! * 1.4);
  expect(sizes[3]!).toBeLessThanOrEqual(60);
  expect(sizes.every((size, index) => index === 0 || size >= sizes[index - 1]!)).toBe(true);
  await page.goto('/writing/sample/');
  expect(await page.locator('html').evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBe(16);
});

test('enlarged desktop text remains reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 960 });
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  for (const theme of ['dark', 'light']) {
    await page.getByLabel('Appearance').selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ['Explore Writing', 'View Projects']) {
      const button = page.getByRole('link', { name, exact: false }).first();
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
    await page.getByLabel('Pause contour motion').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Pause contour motion')).toBeInViewport();
  }
});


test('the tablet-to-desktop boundary does not jump hero height in tall windows', async ({ page }) => {
  await page.goto('/');
  for (const height of [900, 1080, 2160]) {
    const heights = [];
    for (const width of [1000, 1001, 1002]) {
      await page.setViewportSize({ width, height });
      heights.push((await page.locator('.built-hero').boundingBox())!.height);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(3);
  }
});


test('image-source crossover preserves composition at the tablet boundary', async ({ page }) => {
  await page.goto('/');
  for (const height of [900, 1080]) {
    const points: { x: number; y: number }[][] = [];
    for (const width of [1000, 1001]) {
      await page.setViewportSize({ width, height });
      const image = page.locator('.hero-background img');
      await image.evaluate(el => (el as HTMLImageElement).decode());
      expect(await image.evaluate(el => (el as HTMLImageElement).currentSrc)).toContain('hero2-ai-restored-4k');
      points.push(await image.evaluate(el => {
        const image = el as HTMLImageElement;
        const box = image.getBoundingClientRect();
        const scale = Math.max(box.width / image.width, box.height / image.height);
        const [horizontal, vertical] = getComputedStyle(image).objectPosition.split(' ').map(Number.parseFloat);
        return [[.287, .165], [.79, .32], [.79, .745]].map(([x, y]) => ({
          x: x! * image.width * scale - (image.width * scale - box.width) * horizontal! / 100,
          y: y! * image.height * scale - (image.height * scale - box.height) * vertical! / 100,
        }));
      }));
    }
    for (let landmark = 0; landmark < points[0]!.length; landmark++) {
      expect(Math.abs(points[1]![landmark]!.x - points[0]![landmark]!.x)).toBeLessThan(3);
      expect(Math.abs(points[1]![landmark]!.y - points[0]![landmark]!.y)).toBeLessThan(3);
    }
  }
});


test('high-density mobile screens do not download desktop-sized hero encodings', async ({ browser }) => {
  for (const density of [1.75, 3]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: density });
    try {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:4321/');
      const source = await page.locator('.hero-background img').evaluate(async el => {
        const image = el as HTMLImageElement;
        await image.decode();
        return image.currentSrc;
      });
      const candidates = await page.locator('source[type="image/avif"][media]').getAttribute('srcset');
      expect(candidates!.split(',').some(candidate => source === new URL(candidate.trim().split(' ')[0]!, page.url()).href)).toBe(true);
      const response = await page.request.get(source);
      expect((await response.body()).byteLength).toBeLessThan(100_000);
    } finally { await context.close(); }
  }
});
