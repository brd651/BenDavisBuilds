import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { chooseTheme } from './theme';

const principles = [
  'Develop People, Not Just Results',
  'Build Confidence',
  'Stay Curious and Keep Learning',
  'Remove Friction Before Adding Process',
  'Accountability Starts With Clarity',
];
const sections = [
  'Where My Leadership Began',
  'The Five Principles',
  'Does It Scale?',
  'Technical Integrity. Commercial Outcomes.',
  'Coach Up, Not Out',
  'No Surprises.',
  'What Success Looks Like',
];

for (const [width, height] of [[3840, 2160], [2560, 1440], [1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [320, 844]] as const) {
  test(`leadership content, links and accessibility at ${width}px in both themes`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['dark', 'light']) {
      await page.goto('/leadership/');
      await chooseTheme(page, theme);
      await expect(page.locator('h1')).toHaveText('How I Lead.');
      expect(await page.locator('article h2').allTextContents()).toEqual(sections);
      expect(await page.locator('.leadership-chapter h3').allTextContents()).toEqual(principles);
      await expect(page.locator('.leadership-operating ol > li')).toHaveCount(5);
      for (const index of await page.locator('.decision-index').all()) {
        const lines = await index.evaluate(el => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return [...range.getClientRects()].map(rect => ({ width: rect.width, available: el.getBoundingClientRect().width }));
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]!.width).toBeLessThanOrEqual(lines[0]!.available + 1);
      }
      await expect(page.locator('.principle-index li')).toHaveCount(5);
      await expect(page.locator('.leadership-origin')).toContainText('My leadership began as a U.S. Marine Corps NCO.');
      await expect(page.locator('.leadership-case dt')).toHaveText(['01Situation', '02Insight', '03Decision', '04Documented outcome']);
      expect(await page.locator('.leadership-operating').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(theme === 'light' ? 'rgb(238, 234, 225)' : 'rgb(245, 243, 234)');
      await expect(page.locator('#coaching')).toContainText('A fair chance to succeed must come with honest feedback and a reasonable timeframe.');
      await expect(page.locator('.leadership-success')).toContainText(/That, to me, is leadership(?:\.{3}|…)/);
      await expect(page.locator('.leadership-transparency')).toContainText('I resolve what belongs at my level');
      expect(await page.locator('.leadership-heading h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(176);
      await expect(page.locator('footer')).not.toContainText('development template');
      expect(await page.locator('article').innerText()).not.toMatch(/\u2014|Lorem ipsum|placeholder/i);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const links = await page.locator('article a[href]').evaluateAll(elements => elements.map(el => el.getAttribute('href')!));
      for (const href of links) {
        if (href.startsWith('#')) await expect(page.locator(href)).toHaveCount(1);
        else expect((await request.get(href)).status(), href).toBe(200);
      }
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(result.violations).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
}

test('leadership metadata, About discovery, keyboard and System preference', async ({ page }) => {
  await page.goto('/about/');
  await page.getByRole('link', { name: 'Read my leadership philosophy' }).click();
  await expect(page).toHaveURL('/leadership/');
  await expect(page).toHaveTitle('How I Lead. · Ben Davis Builds');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://bendavisbuilds.com/leadership/');
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://bendavisbuilds.com/leadership/');
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', await page.locator('meta[name="description"]').getAttribute('content') ?? '');
  await page.reload();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const anchor = page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Does It Scale?' });
  await anchor.focus();
  expect(await anchor.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#the-operating-question-does-it-scale$/);
  await expect(page.locator('#the-operating-question-does-it-scale')).toBeFocused();
  await expect.poll(() => page.locator('#the-operating-question-does-it-scale').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  const card = page.locator('.principle-index a').first();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#principle-01')).toBeFocused();
  await expect.poll(() => page.locator('#principle-01').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await chooseTheme(page, 'system');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).scrollBehavior)).toBe('auto');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('all leadership copy survives no JavaScript and 200% text reflow', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 844 } });
  await context.route('**/leadership/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('</head>', '<style>html { font-size: 200%; }</style></head>') });
  });
  const page = await context.newPage();
  await page.goto('/leadership/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (const heading of [...sections, ...principles]) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText('The deal closed without the additional PoC, and the customer purchased additional Professional Services.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const link of await page.locator('.principle-index a, .leadership-contents a').all()) await expect(link).toBeVisible();
  await context.close();
});
