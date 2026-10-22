import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { careerStages } from '../src/data/career';
import { chooseTheme } from './theme';

const profiles = [[390,844],[768,1024],[1440,900],[1920,1080],[3840,2160]] as const;
const words = (text: string) => text.split(/\s+/).filter(Boolean).sort();
for (const theme of ['dark', 'light']) for (const [width, height] of profiles) {
  test(`About editorial test ${theme} ${width}: content, visuals and accessibility`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(t => localStorage.setItem('built-signal-theme', t), theme);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    expect((await page.goto('/about/test/'))?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('A career built through curiosity.');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://bendavisbuilds.com/about/test/');
    await expect(page.getByRole('link', { name: 'View the current About page' })).toHaveAttribute('href', '/about/');
    await expect(page.locator('.career-stage')).toHaveCount(7);
    await expect(page.getByRole('link', { name: 'Follow the progression' })).toHaveCount(0);
    await expect(page.locator('[data-timeline-motion]')).toHaveCount(0);
    await expect(page.locator('.chapter-display')).toHaveCount(7);
    await expect(page.locator('#marine-corps img')).toHaveAttribute('src', '/about/organizations/usmc-ega.svg');
    await expect(page.locator('.carry-forward')).toHaveCount(7);
    await expect(page.locator('.career-artifact')).toHaveCount(3);
    await expect(page.locator('.career-stage details')).toHaveCount(3);
    await page.locator('details').evaluateAll(elements => elements.forEach(el => { if (el instanceof HTMLDetailsElement && el.closest('.career-stage')) el.open = true; }));
    // Preserve every original prose word exactly once, even when relocated into a note.
    for (const stage of careerStages) {
      const expected = [stage.summary, ...(stage.expansion?.sections.map(section => section.body) ?? [])].join(' ');
      const actual = await page.locator(`#${stage.id}`).locator('.stage-story > p, .carry-forward blockquote p, .detail-section p').allTextContents();
      expect(words(actual.join(' '))).toEqual(words(expected));
      await expect(page.locator(`#${stage.id} .stage-organization`)).toHaveText(stage.organization);
    }
    await expect(page.locator('.reproduction figcaption')).toContainText('Illustrative');
    await expect(page.locator('.automation figcaption')).toContainText('Illustrative');
    await expect(page.locator('.archive a')).toHaveAttribute('href', 'https://web.archive.org/web/20190109115510/https://theoryit.com/');
    await page.locator('#sonicwall .stage-story h3').hover();
    await expect.poll(() => page.locator('#western-nrg .stage-identity').evaluate(el => Number(getComputedStyle(el).opacity))).toBeCloseTo(.68, 2);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('article').innerText()).not.toMatch(/\u2014|Lorem ipsum|(?:19|20)\d{2}/);
    const portrait = page.getByRole('img', { name: 'Professional portrait of Ben Davis' });
    await expect(portrait).toBeVisible();
    expect(await portrait.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(portrait).toHaveAttribute('width', /^\d+$/);
    await expect(portrait).toHaveAttribute('height', /^\d+$/);
    if (width > 650) await expect(page.locator('.journey-art')).toBeVisible();
    else await expect(page.locator('.journey-art')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

for (const theme of ['dark', 'light']) test(`About editorial floating index, anchors, wave and theme ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(t => localStorage.setItem('built-signal-theme', t), theme);
  await page.goto('/about/test/');
  const nav = page.getByRole('navigation', { name: 'Career chapters', exact: true });
  await expect(nav).toBeHidden();
  await page.locator('#marine-corps').scrollIntoViewIfNeeded();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: '03 SonicWall', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sonicwall')).toBeFocused();
  await expect(nav.locator('a[aria-current="location"]')).toHaveAttribute('href', '#sonicwall');
  expect(await nav.evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  await page.locator('#palo-alto-networks').scrollIntoViewIfNeeded();
  await expect(nav.locator('a[aria-current="location"]')).toHaveAttribute('href', '#palo-alto-networks');
  const sticky = await nav.boundingBox();
  expect(sticky!.y).toBeGreaterThanOrEqual(0);
  expect(sticky!.y + sticky!.height).toBeLessThan(900);
  const reading = await page.locator('.career-reading').boundingBox();
  expect(sticky!.x + sticky!.width).toBeLessThan(reading!.x);
  await expect(page.locator('[data-career-timeline]')).toHaveAttribute('data-motion', 'true');
  const transforms = await page.locator('#palo-alto-networks').evaluate(stage => ['.milestone', '.stage-identity', '.stage-story'].map(selector => {
    const matrix = new DOMMatrix(getComputedStyle(stage.querySelector(selector)!).transform);
    return { x: matrix.m41, y: matrix.m42 };
  }));
  expect(transforms.every(part => Math.abs(part.x) < .01 && Math.abs(part.y - transforms[0].y) < .01)).toBe(true);
  await expect(page.getByRole('button', { name: 'Pause timeline motion' })).toHaveCount(0);
  await chooseTheme(page, theme === 'dark' ? 'light' : 'dark');
  await chooseTheme(page, 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-career-timeline]')).toHaveAttribute('data-motion', 'false');
  await page.locator('.editorial-heading h1').scrollIntoViewIfNeeded();
  await expect(nav).toBeHidden();
});

for (const javaScriptEnabled of [false, true]) test(`About editorial reflow at 320px without required JS (${javaScriptEnabled})`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 320, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${baseURL}/about/test/`);
  await expect(page.locator('.chapter-index ol a')).toHaveCount(7);
  await expect(page.locator('.carry-forward')).toHaveCount(7);
  await page.locator('#sonicwall summary').click();
  await expect(page.locator('#sonicwall .stage-detail')).toBeVisible();
  await page.locator('html').evaluate(root => root.style.fontSize = '200%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const link of await page.locator('.chapter-index ol a').all()) {
    await expect(link).toHaveAttribute('href', /^#[a-z-]+$/);
  }
  await context.close();
});

test('Design experiment stays out of discovery and canonical About keeps its original content', async ({ page, request }) => {
  expect((await (await request.get('/sitemap.xml')).text())).not.toContain('/about/test/');
  expect((await (await request.get('/search-index.json')).text())).not.toContain('/about/test/');
  expect((await (await request.get('/rss.xml')).text())).not.toContain('/about/test/');
  await page.goto('/about/');
  await expect(page.locator('h1')).toHaveText('About Ben Davis.');
  await expect(page.locator('.carry-forward, .career-artifact, .chapter-index')).toHaveCount(0);
  for (const stage of careerStages) await expect(page.locator(`#${stage.id} .stage-story > p`)).toHaveText(stage.summary);
});


test('Flowing-time hero settles at rest and honors reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/about/test/');
  const paths = page.locator('.flow-highlights path');
  await expect(paths).toHaveCount(3);
  const styles = await paths.evaluateAll(elements => elements.map(el => {
    const style = getComputedStyle(el);
    return { iterations: style.animationIterationCount, duration: parseFloat(style.animationDuration), delay: parseFloat(style.animationDelay) };
  }));
  expect(styles.every(s => s.iterations === '1' && s.duration + s.delay < 5)).toBe(true);
  await page.waitForTimeout(4600);
  const before = await paths.evaluateAll(elements => elements.map(el => getComputedStyle(el).strokeDashoffset));
  await page.waitForTimeout(150);
  expect(await paths.evaluateAll(elements => elements.map(el => getComputedStyle(el).strokeDashoffset))).toEqual(before);
  await page.evaluate(() => scrollBy(0, 120));
  await expect.poll(() => paths.first().evaluate(el => getComputedStyle(el).strokeDashoffset)).not.toBe(before[0]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await paths.evaluateAll(elements => elements.every(el => getComputedStyle(el).animationName === 'none'))).toBe(true);
});


for (const width of [1440, 1920, 3840]) test(`Chapter menu stays inside timeline at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 3840 ? 2160 : 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/about/test/');
  const nav = page.locator('.chapter-index');
  const region = page.locator('[data-career-editorial]');
  const bounds = await region.evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, bottom: el.getBoundingClientRect().bottom + scrollY }));
  for (const y of [bounds.top - (width === 3840 ? 1200 : 500), bounds.top + 500, bounds.bottom - 250]) {
    await page.evaluate(y => scrollTo(0, y), y);
    await expect(nav).toBeVisible();
    const menu = (await nav.boundingBox())!;
    const timeline = (await region.boundingBox())!;
    expect(menu.y).toBeGreaterThanOrEqual(timeline.y - 1);
    expect(menu.y + menu.height).toBeLessThanOrEqual(timeline.y + timeline.height + 1);
    expect(menu.x).toBeGreaterThanOrEqual(8);
    const gap = timeline.x - (menu.x + menu.width);
    expect(gap).toBeGreaterThanOrEqual(width >= 1920 ? 178 : 44);
  }
});
