import { chooseTheme } from './theme';
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

test('contours have slow traveling highlights and a reduced-motion fallback without a pause control', async ({ page }) => {
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
  await expect(page.getByLabel('Pause contour motion')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await overlay.locator('.contour-highlight').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
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
  await expect(page.locator('.homepage-search')).toHaveCount(1);
  await expect(page.locator('.topographic-overlay')).toHaveCount(0);
});

test('without JavaScript search navigation still works', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'no-preference' });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('Search this site').click();
    await expect(page.locator('.homepage-search').getByRole('link', { name: 'Writing', exact: true })).toBeVisible();
    await expect(page.getByLabel('Search pages')).toBeHidden();
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
  await page.route('/', async route => {
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
      await page.goto('/');
      const image = page.locator('.hero-background img');
      await image.evaluate(async el => { if (el instanceof HTMLImageElement) await el.decode(); });
      const framing = await image.evaluate(el => {
        if (!(el instanceof HTMLImageElement)) throw new Error('Hero image missing');
        const box = el.getBoundingClientRect();
        const sourceWidth = Number(el.getAttribute('width'));
        const sourceHeight = Number(el.getAttribute('height'));
        const scale = Math.max(box.width / sourceWidth, box.height / sourceHeight);
        const drawn = { width: sourceWidth * scale, height: sourceHeight * scale };
        // Account for object-position when checking mountain peak and hiker head/feet.
        const [horizontal, vertical] = getComputedStyle(el).objectPosition.split(' ').map(Number.parseFloat);
        const landmark = (x: number, y: number) => ({ x: x * drawn.width - (drawn.width - box.width) * horizontal! / 100,
          y: y * drawn.height - (drawn.height - box.height) * vertical! / 100 });
        return { width: box.width, height: box.height, encodedWidth: sourceWidth, source: el.currentSrc,
          position: getComputedStyle(el).objectPosition, points: [landmark(.287, .165), landmark(.79, .32), landmark(.79, .675)] };
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
    await chooseTheme(page, theme);
    for (const breakpoint of [1400, 1800, 1920, 2560]) {
      const frames = [];
      for (const width of [breakpoint - 1, breakpoint, breakpoint + 1]) {
        await page.setViewportSize({ width, height: 1080 });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
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
    await chooseTheme(page, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ['Explore Writing', 'View Projects']) {
      const button = page.getByRole('link', { name, exact: false }).first();
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
  }
});


test('tablet-to-desktop sizing follows chrome reflow without an extra height jump', async ({ page }) => {
  await page.goto('/');
  for (const height of [900, 1080, 2160]) {
    const stages: { hero: number; chrome: number }[] = [];
    for (const width of [1000, 1001, 1002]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      stages.push(await page.evaluate(() => ({
        hero: document.querySelector('.built-hero')!.getBoundingClientRect().height,
        chrome: document.querySelector('.development-notice')!.getBoundingClientRect().height + document.querySelector('.site-header')!.getBoundingClientRect().height,
      })));
    }
    for (let index = 1; index < stages.length; index++) {
      const before = stages[index - 1]!;
      const after = stages[index]!;
      // A viewport-sized stage compensates for header reflow; a capped stage stays stable.
      expect(Math.min(Math.abs(after.hero - before.hero), Math.abs(after.hero + after.chrome - before.hero - before.chrome))).toBeLessThan(3);
    }
  }
});


test('image-source crossover preserves composition at the tablet boundary', async ({ page }) => {
  await page.goto('/');
  for (const height of [1080]) {
    const points: { x: number; y: number }[][] = [];
    for (const width of [1000, 1001]) {
      await page.setViewportSize({ width, height });
      const image = page.locator('.hero-background img');
      await image.evaluate(el => (el as HTMLImageElement).decode());
      expect(await image.evaluate(el => (el as HTMLImageElement).currentSrc)).toContain('hero2-ai-restored-4k');
      points.push(await image.evaluate(el => {
        const image = el as HTMLImageElement;
        const box = image.getBoundingClientRect();
        const sourceWidth = Number(image.getAttribute('width'));
        const sourceHeight = Number(image.getAttribute('height'));
        const scale = Math.max(box.width / sourceWidth, box.height / sourceHeight);
        const [horizontal, vertical] = getComputedStyle(image).objectPosition.split(' ').map(Number.parseFloat);
        return [[.287, .165], [.79, .32], [.79, .675]].map(([x, y]) => ({
          x: x! * sourceWidth * scale - (sourceWidth * scale - box.width) * horizontal! / 100,
          y: y! * sourceHeight * scale - (sourceHeight * scale - box.height) * vertical! / 100,
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
      await page.goto('/');
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

const polishViewports = [
  [3840, 2160, 1], [2560, 1440, 1], [2560, 1440, 1.5], [1920, 1080, 1],
  [1440, 900, 1], [1366, 768, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1],
];
for (const [width, height, density] of polishViewports) {
  test(`polished hero fits content and anchors terrain at ${width}×${height} ${density}x`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: density });
    try {
      const page = await context.newPage();
      await page.goto('/');
      for (const theme of ['dark', 'light']) {
        await chooseTheme(page, theme);
        const geometry = await page.evaluate(() => {
          const hero = document.querySelector('.built-hero')!.getBoundingClientRect();
          const copy = document.querySelector('.hero-foreground')!.getBoundingClientRect();
          const bottom = document.querySelector('.hero-bottom')!.getBoundingClientRect();
          const intro = document.querySelector('.homepage-main > .shell .eyebrow')!.getBoundingClientRect();
          const image = document.querySelector<HTMLImageElement>('.hero-background img')!;
          const box = image.getBoundingClientRect();
          const svg = document.querySelector('.topographic-overlay')!.getBoundingClientRect();
          const sourceWidth = Number(image.getAttribute('width'));
          const sourceHeight = Number(image.getAttribute('height'));
          const scale = Math.max(box.width / sourceWidth, box.height / sourceHeight);
          const [horizontal, vertical] = getComputedStyle(image).objectPosition.split(' ').map(Number.parseFloat);
          return { preview: innerHeight - hero.bottom, heroWidth: hero.width, overflow: document.documentElement.scrollWidth > innerWidth,
            copyBottom: copy.bottom, bottomTop: bottom.top, introTop: intro.top, introBottom: intro.bottom,
            imageWidth: sourceWidth * scale, imageHeight: sourceHeight * scale,
            imageX: box.x + (box.width - sourceWidth * scale) * horizontal! / 100,
            imageY: box.y + (box.height - sourceHeight * scale) * vertical! / 100,
            svg: { x: svg.x, y: svg.y, width: svg.width, height: svg.height },
          };
        });
        expect(geometry.overflow).toBe(false);
        expect(geometry.heroWidth).toBe(width);
        expect(geometry.copyBottom).toBeLessThanOrEqual(geometry.bottomTop);
        expect(Math.abs(geometry.svg.width - geometry.imageWidth)).toBeLessThan(1);
        expect(Math.abs(geometry.svg.height - geometry.imageHeight)).toBeLessThan(1);
        expect(Math.abs(geometry.svg.x - geometry.imageX)).toBeLessThan(1);
        expect(Math.abs(geometry.svg.y - geometry.imageY)).toBeLessThan(1);
        if (width >= 1024) {
          expect(geometry.preview).toBeGreaterThanOrEqual(80);
          expect(geometry.preview).toBeLessThanOrEqual(100);
          expect(geometry.introTop).toBeGreaterThan(0);
          expect(geometry.introBottom).toBeLessThanOrEqual(height);
        }
        if (width <= 1100) await expect(page.locator('.hero-hud')).toBeHidden();
        else await expect(page.locator('.hero-hud')).toBeVisible();
      }
    } finally { await context.close(); }
  });
}

test('stage sizing follows actual banner growth rather than a fixed header allowance', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.locator('.development-notice').evaluate(el => { (el as HTMLElement).style.paddingBlock = '2rem'; });
  await expect.poll(async () => {
    const hero = await page.locator('.built-hero').boundingBox();
    return 1080 - hero!.y - hero!.height;
  }).toBeCloseTo(90, 0);
});

test('ultrawide backgrounds have no source-width side margins and type stays bounded', async ({ page }) => {
  await page.setViewportSize({ width: 5120, height: 1440 });
  await page.goto('/');
  const hero = await page.locator('.built-hero').boundingBox();
  expect(hero!.x).toBe(0);
  expect(hero!.width).toBe(5120);
  const landmarks = await page.locator('.hero-background img').evaluate(el => {
    const image = el as HTMLImageElement;
    const box = image.getBoundingClientRect();
    const sourceWidth = Number(image.getAttribute('width'));
    const sourceHeight = Number(image.getAttribute('height'));
    const scale = Math.max(box.width / sourceWidth, box.height / sourceHeight);
    const vertical = Number.parseFloat(getComputedStyle(image).objectPosition.split(' ')[1]!);
    return [.165, .675].map(y => box.y + y * sourceHeight * scale - (sourceHeight * scale - box.height) * vertical / 100);
  });
  for (const y of landmarks) {
    expect(y).toBeGreaterThanOrEqual(hero!.y);
    expect(y).toBeLessThanOrEqual(hero!.y + hero!.height);
  }
  expect(await page.locator('h1').evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
