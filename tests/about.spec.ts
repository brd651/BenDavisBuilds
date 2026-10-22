import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { chooseTheme } from './theme';

const profiles = [[3840,2160],[2560,1440],[1920,1080],[1440,900],[1366,768],[1024,768],[768,1024],[390,844]] as const;
const organizations = ['United States Marine Corps', 'University of Advancing Technology', 'SonicWall', 'Western NRG', 'Sophos', 'Palo Alto Networks', 'Ben Davis Builds'];
for (const theme of ['dark', 'light']) for (const [width, height] of profiles) {
  test(`About ${theme} ${width}x${height}: progression, layout, accessibility`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(t => localStorage.setItem('built-signal-theme', t), theme);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    expect((await page.goto('/about/'))?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('About Ben Davis.');
    const portrait = page.getByRole('img', { name: 'Professional portrait of Ben Davis' });
    await expect(portrait).toBeVisible();
    expect(await portrait.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const logos = page.locator('.stage-logo img:visible');
    await expect(logos).toHaveCount(5);
    for (const logo of await logos.all()) {
      await logo.scrollIntoViewIfNeeded();
      await expect.poll(() => logo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const geometry = await logo.evaluate((el: HTMLImageElement) => ({ actual: el.width / el.height, original: el.naturalWidth / el.naturalHeight }));
      expect(Math.abs(geometry.actual / geometry.original - 1)).toBeLessThan(.02);
    }
    expect(await page.locator('.stage-organization').allTextContents()).toEqual(organizations);
    await expect(page.locator('.stage-personal .stage-type')).toHaveText('Ongoing personal project');
    expect(await page.locator('.career-stage').count()).toBe(7);
    await expect(page.locator('.career-stage details')).toHaveCount(3);
    await expect(page.locator('#marine-corps details, #education details, #western-nrg details, #ben-davis-builds details')).toHaveCount(0);
    expect(await page.locator('.career-stage summary').allTextContents()).toEqual([
      'Reproducing failures in the lab+', 'Coaching across regions and teams+', 'Developing teams and technical execution+',
    ]);
    await expect(page.locator('#western-nrg .stage-story')).toContainText('reducing repetitive work');
    await expect(page.locator('#ben-davis-builds .timeline-brand-mark')).toHaveCount(1);
    expect(await page.locator('.timeline-connector').count()).toBe(6);
    expect(await page.locator('article').innerText()).not.toMatch(/(?:19|20)\d{2}|Lorem ipsum|2000|2004|2014/);
    await page.locator('.career-stages').evaluate(el => el.querySelectorAll('details').forEach(detail => detail.open = true));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const geometry = await page.locator('.career-stages').evaluate(el => {
      const stages = [...el.querySelectorAll('.career-stage')];
      return stages.slice(0, -1).map((stage, i) => {
        const rail = stage.querySelector('.timeline-connector')!.getBoundingClientRect();
        const first = stage.querySelector('.milestone')!.getBoundingClientRect();
        const next = stages[i+1]!.querySelector('.milestone')!.getBoundingClientRect();
        return { start: Math.abs(rail.top - (first.top + first.height / 2)), end: Math.abs(rail.bottom - (next.top + next.height / 2)), x: Math.abs((rail.left + rail.width/2) - (first.left + first.width/2)) };
      });
    });
    for (const rail of geometry) { expect(rail.start).toBeLessThan(1); expect(rail.end).toBeLessThan(1); expect(rail.x).toBeLessThan(1); }
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('About scroll reveals lines and milestones; changing motion preference completes them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/about/');
  const timeline = page.locator('[data-career-timeline]');
  await page.locator('#marine-corps').scrollIntoViewIfNeeded();
  await expect(timeline).toHaveAttribute('data-motion', 'true');
  await expect(page.locator('#marine-corps')).toHaveClass(/is-seen/);
  await expect.poll(() => page.locator('.timeline-connector').first().evaluate(el => Number(getComputedStyle(el).getPropertyValue('--line-offset')))).toBeLessThan(1);
  await page.locator('#western-nrg').scrollIntoViewIfNeeded();
  await expect(page.locator('#western-nrg')).toHaveClass(/is-seen/);
  await expect.poll(() => page.locator('.timeline-connector').first().evaluate(el => Number(getComputedStyle(el).getPropertyValue('--line-offset')))).toBe(0);
  await page.locator('#ben-davis-builds').scrollIntoViewIfNeeded();
  await expect(page.locator('#ben-davis-builds')).toHaveClass(/is-seen/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(timeline).toHaveAttribute('data-motion', 'false');
  expect(await page.locator('.connector-progress').first().evaluate(el => getComputedStyle(el).strokeDasharray)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(timeline).toHaveAttribute('data-motion', 'true');
  await page.locator('#marine-corps').scrollIntoViewIfNeeded();
  await expect(page.locator('#marine-corps')).toHaveClass(/is-seen/);
});

test('About keyboard chapters, native disclosures, focus and themes', async ({ page }) => {
  await page.goto('/about/');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const link = page.getByRole('link', { name: '03 SonicWall', exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sonicwall')).toBeFocused();
  expect(await page.locator('#sonicwall').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await page.locator('#sonicwall summary').focus();
  expect(await page.locator('#sonicwall summary').evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sonicwall details')).toHaveAttribute('open', '');
  await expect(page.locator('#sonicwall .stage-detail')).toBeVisible();
  await chooseTheme(page, 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await chooseTheme(page, 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

for (const javaScriptEnabled of [false, true]) test(`About fallbacks and 200% text at 320px (JS ${javaScriptEnabled})`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 320, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${baseURL}/about/`);
  await expect(page.locator('#marine-corps .stage-story')).toBeVisible();
  await expect(page.locator('#ben-davis-builds .stage-story')).toBeVisible();
  await page.locator('#sonicwall summary').click();
  await expect(page.locator('#sonicwall .stage-detail')).toBeVisible();
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%'; });
  expect(await page.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('#marine-corps .milestone')).toBeVisible();
  if (javaScriptEnabled) await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await context.close();
});

test('About remains readable when observer APIs are unavailable', async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'IntersectionObserver'); Reflect.deleteProperty(window, 'ResizeObserver'); });
  await page.goto('/about/');
  await expect(page.locator('[data-career-timeline]')).toHaveAttribute('data-motion', 'false');
  await expect(page.locator('#sonicwall .stage-story')).toBeVisible();
  expect(await page.locator('.connector-progress').first().evaluate(el => getComputedStyle(el).strokeDasharray)).toBe('none');
});

for (const width of [390, 768, 1440, 1920, 3840]) test(`About System mode and local imagery at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('built-signal-theme', 'system'));
  const external: string[] = [];
  page.on('request', req => { if (!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|bendavisbuilds\.com)$/)) external.push(req.url()); });
  await page.goto('/about/');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#palo-alto-networks').scrollIntoViewIfNeeded();
  await expect(page.locator('#palo-alto-networks .logo-light')).toBeVisible();
  await expect(page.locator('#palo-alto-networks .logo-dark')).toBeHidden();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#palo-alto-networks .logo-dark')).toBeVisible();
  await expect(page.locator('#palo-alto-networks .logo-light')).toBeHidden();
  const disclosures = page.locator('.career-stage details');
  for (const disclosure of await disclosures.all()) {
    await disclosure.locator('summary').click();
    expect((await disclosure.locator('.stage-detail').innerText()).length).toBeGreaterThan(250);
    await expect(disclosure.locator('h4').first()).toBeVisible();
  }
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(external).toEqual([]);
});
