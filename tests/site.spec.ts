import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = ['/', '/about/', '/writing/', '/writing/sample/', '/writing/archive/', '/projects/', '/lab/', '/mentorship/', '/contact/'];
for (const width of [390, 768, 1440]) {
  for (const theme of ['dark', 'light']) {
    test(`${theme} pages at ${width}px: routes, accessibility, overflow, console`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(mode => localStorage.setItem('built-signal-theme', mode), theme);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      for (const route of routes) {
        const response = await page.goto(route);
        expect(response?.status(), route).toBe(200);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByText('Development preview', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), route).toBe(true);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(result.violations, `${route}: ${JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))}`).toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('dark first visit, explicit persistence, System follows OS only when selected', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Appearance').selectOption('light');
  await page.goto('/writing/sample/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Appearance').selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.getByLabel('Appearance')).toHaveValue('system');
});

test('storage failure preserves usable theme control', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('Storage unavailable'); } });
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Appearance').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('keyboard skip link and theme selection', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.getByLabel('Appearance').focus();
  expect(await page.getByLabel('Appearance').evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('content, navigation and dark theme survive without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  for (const route of routes) {
    await page.goto(`http://127.0.0.1:4321${route}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByLabel('Appearance')).toBeHidden();
  }
  await context.close();
});

test('404 response, noindex and internal links', async ({ page, request }) => {
  const response = await page.goto('/missing-page/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('isn’t here');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /');
  await page.goto('/');
  const links = await page.locator('a[href^="/"]').evaluateAll(elements => [...new Set(elements.map(el => el.getAttribute('href')!))]);
  for (const href of links) expect((await request.get(href)).status(), href).toBe(200);
});

test('reduced motion, forced colors and enlarged text remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await page.goto('/lab/');
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).scrollBehavior)).toBe('auto');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('img', { name: 'Simulated static build workflow' })).toBeVisible();
});
