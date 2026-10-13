import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { chooseTheme } from './theme';

const profiles = [[390,844],[768,1024],[1366,768],[1440,900],[1920,1080],[2560,1440],[3840,2160]] as const;
for (const theme of ['dark', 'light']) for (const [width, height] of profiles) {
  test(`Writing publication ${theme} ${width}px: editorial hierarchy, images and accessibility`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(t => localStorage.setItem('built-signal-theme', t), theme);
    expect((await page.goto('/writing/'))?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Writing & Field Notes.');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.demonstration-notice')).toContainText('not genuine published articles');
    const feature = page.getByRole('region', { name: 'Featured writing' });
    await expect(feature.getByRole('heading', { level: 2 })).toHaveText('Demonstration: from Markdown to a static article');
    await expect(feature).toContainText('Featured sample');
    await expect(feature).toContainText('min read (estimate)');
    await expect(feature.locator('time')).toHaveCount(0);
    await expect(feature.locator('.story-category')).toHaveAttribute('href', '/writing/category/engineering/');
    await expect(feature.locator('img')).toHaveAttribute('alt', /Illustrative publishing flow/);
    expect(await feature.locator('img').evaluate(el => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(feature.locator('source[type="image/avif"]')).toHaveAttribute('srcset', /480w.*768w.*1120w.*1600w/);
    await expect(page.locator('.writing-grid .writing-story')).toHaveCount(2);
    const index = await (await request.get('/search-index.json')).json() as { url: string; readingMinutes: number }[];
    const estimate = index.find(entry => entry.url === '/writing/technical-sample/')!.readingMinutes;
    await expect(feature.locator('.story-meta')).toContainText(`${estimate} min read (estimate)`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.writing-landing').boundingBox())!.width).toBeLessThanOrEqual(1200);
    expect((await page.locator('.writing-hero').boundingBox())!.height).toBeLessThan(width <= 700 ? 600 : 421);
    const hero = page.locator('.writing-hero img');
    await expect(hero).toHaveAttribute('loading', 'eager');
    await expect(hero).toHaveAttribute('fetchpriority', 'high');
    await expect(page.locator('.writing-hero source[type="image/avif"]')).toHaveAttribute('srcset', /480w.*768w.*1120w.*1672w/);
    expect(await hero.evaluate(el => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0)).toBe(true);
    if (width <= 1100) await page.getByRole('button', {name: 'Menu'}).click();
    await expect(page.locator('.writing-landing a[href="/projects/"]')).toHaveCount(0);
    await expect(page.locator('.site-header').getByRole('link', { name: 'Projects', exact: true })).toHaveCount(1);
    await expect(page.getByRole('complementary', { name: 'The historical archive.' })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  });
}

test('publication article, chip, search and RSS links retain their actual destinations', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/writing/');
  const links = await page.locator('.writing-landing a').evaluateAll(elements => [...new Set(elements.map(el => el.getAttribute('href')!))]);
  for (const href of links) expect((await request.get(href)).status(), href).toBe(200);
  for (const nav of ['Browse categories', 'Browse tags']) {
    const chip = page.getByRole('navigation', { name: nav }).getByRole('link').first();
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const href = await chip.getAttribute('href'); await chip.focus();
    expect(await chip.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter'); await expect(page).toHaveURL(href!);
    await page.goto('/writing/');
  }
  const search = page.getByRole('link', { name: 'Search articles', exact: true });
  await search.focus(); await page.keyboard.press('Enter'); await expect(page).toHaveURL('/writing/search/');
  await page.getByLabel('Search articles by topic, title, or text').fill('professional experience');
  await expect(page.locator('#search-status')).toHaveText('1 article found.');
  await page.locator('.search-results a').click(); await expect(page).toHaveURL('/writing/leadership-sample/');
  await page.goto('/writing/');
  await page.getByRole('link', { name: /Explore the historical archive/ }).click(); await expect(page).toHaveURL('/writing/archive/');
  expect(errors).toEqual([]);
});

test('publication remains usable with System, reduced motion, forced colors and without JavaScript', async ({ page, browser, baseURL }) => {
  await page.goto('/writing/'); await chooseTheme(page, 'system');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 }, reducedMotion: 'reduce' });
  const staticPage = await context.newPage(); await staticPage.goto(`${baseURL}/writing/`);
  await staticPage.locator('html').evaluate(el => { el.style.fontSize = '200%'; });
  await expect(staticPage.locator('.featured-story')).toBeVisible();
  expect(await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await staticPage.emulateMedia({ forcedColors: 'active' });
  const link = staticPage.locator('.writing-search'); await link.focus();
  expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await staticPage.keyboard.press('Enter'); await expect(staticPage.locator('.search-fallback')).toBeVisible();
  await expect(staticPage.locator('.search-controls')).toBeHidden(); await context.close();
});
