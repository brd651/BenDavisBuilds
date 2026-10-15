import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { chooseTheme } from './theme';

const profiles = [[390,844],[768,1024],[1440,900],[1920,1080],[3840,2160]] as const;
const destinations = ['https://www.linkedin.com/in/brd651/', 'https://github.com/brd651', 'https://x.com/BenDavis651'];
const labels = ['LinkedIn', 'GitHub', 'X'];
const routes = ['/', '/about/', '/leadership/', '/writing/', '/writing/sample/', '/writing/archive/', '/projects/', '/lab/', '/mentorship/', '/contact/', '/missing-page/'];

for (const theme of ['dark', 'light']) for (const [width, height] of profiles) {
  test(`shared footer ${theme} at ${width}px: social access and compact layout`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(t => localStorage.setItem('built-signal-theme', t), theme);
    await page.goto('/about/');
    const footer = page.getByRole('contentinfo');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toHaveCount(1);
    await expect(footer.getByText('Ben Davis Builds', { exact: true })).toBeVisible();
    await expect(footer.locator('.footer-description, .fine-print')).toHaveCount(0);
    await expect(footer.locator('#privacy-notice summary')).toHaveText('Privacy');
    await expect(footer.locator('.footer-copyright')).toHaveText(`© ${new Date().getUTCFullYear()} Ben Davis Builds`);
    const social = footer.getByRole('navigation', { name: 'Social profiles' });
    expect(await social.locator('a').evaluateAll(elements => elements.map(el => el.getAttribute('href')))).toEqual(destinations);
    for (const label of labels) {
      const link = social.getByRole('link', { name: `Ben Davis on ${label} (opens in a new tab)`, exact: true });
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      const box = await link.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(footer.getByRole('navigation', { name: 'Footer navigation' })).toHaveCount(0);
    await expect(footer.getByRole('link', { name: 'Contact', exact: true })).toHaveAttribute('href', '/contact/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await footer.boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(1200);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    expect(result.violations).toEqual([]);
  });
}

test('one shared footer appears across all static routes and the real 404', async ({ page }) => {
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(route === '/missing-page/' ? 404 : 200);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveCount(1);
    expect(await footer.getByRole('navigation', { name: 'Social profiles' }).locator('a').evaluateAll(elements => elements.map(el => el.getAttribute('href')))).toEqual(destinations);
    await expect(footer.getByRole('link', { name: /Privacy/i })).toHaveCount(0);
    await expect(footer.locator('a[href="#"], iframe, script[src^="http"]')).toHaveCount(0);
  }
});

test('social keyboard order, focus, hover, and System changes remain usable', async ({ page }) => {
  await page.goto('/contact/');
  const social = page.getByRole('navigation', { name: 'Social profiles' });
  const links = social.getByRole('link');
  await links.first().focus();
  for (let i = 0; i < labels.length; i++) {
    await expect(links.nth(i)).toBeFocused();
    expect(await links.nth(i).evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    if (i < labels.length - 1) await page.keyboard.press('Tab');
  }
  await page.locator('main').focus();
  await page.mouse.move(0, 0);
  const normal = await links.first().evaluate(el => getComputedStyle(el).color);
  await links.first().hover();
  const hovered = await links.first().evaluate(el => getComputedStyle(el).color);
  expect(hovered).not.toBe(normal);
  await chooseTheme(page, 'system');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await links.first().focus();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    expect(result.violations).toEqual([]);
  }
});

test('static footer works without JavaScript and at 200% text in 320px', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${baseURL}/writing/sample/`);
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%'; });
  const footer = page.getByRole('contentinfo');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('navigation', { name: 'Social profiles' })).toBeVisible();
  expect(await footer.getByRole('navigation', { name: 'Social profiles' }).locator('a').count()).toBe(3);
  expect(await page.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.emulateMedia({ forcedColors: 'active' });
  await footer.getByRole('link', { name: 'Ben Davis on LinkedIn (opens in a new tab)' }).focus();
  expect(await footer.getByRole('link', { name: 'Ben Davis on LinkedIn (opens in a new tab)' }).evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await context.close();
});
