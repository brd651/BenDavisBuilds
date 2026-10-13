import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const width of [390, 768, 1366]) test(`shared navigation: links, disclosures and keyboard at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/writing/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const menu = page.getByRole('button', { name: 'Menu' });
  if (width <= 1100) {
    await expect(nav).toBeHidden();
    await menu.focus(); await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
  await expect(page.locator('.site-header .wordmark')).toHaveAttribute('href', '/');
  await expect(nav.getByRole('link', { name: 'About Me', exact: true })).toHaveAttribute('href', '/about/');
  await expect(nav.getByRole('link', { name: 'Leadership', exact: true })).toHaveAttribute('href', '/leadership/');
  const writing = nav.getByLabel('Writing options');
  const projects = nav.getByLabel('Projects options');
  await writing.focus(); await page.keyboard.press('Space');
  await expect(writing).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'Historical Archive', exact: true })).toBeVisible();
  await page.keyboard.press('Tab'); await expect(nav.getByRole('link', { name: 'All Writing', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(writing).toBeFocused(); await expect(writing).toHaveAttribute('aria-expanded', 'false');
  await writing.click(); await projects.click();
  await expect(writing).toHaveAttribute('aria-expanded', 'false');
  await expect(projects).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'Homelab', exact: true })).toHaveAttribute('href', '/lab/');
  await expect(nav.getByRole('link', { name: 'Public Mission Control', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Mentorship', exact: true }).focus();
  await expect(projects).toHaveAttribute('aria-expanded', 'false');
  if (width <= 1100) {
    await page.keyboard.press('Escape'); await expect(menu).toBeFocused(); await expect(nav).toBeHidden();
    await menu.click();
  }
  expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  for (const href of await nav.locator('a').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href')!))])) expect((await request.get(href)).status(), href).toBe(200);
  await writing.click(); await page.locator('h1').click();
  await expect(page.locator('summary[aria-label="Writing options"]')).toHaveAttribute('aria-expanded', 'false');
  if (width <= 1100) await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('no-JS primary destinations and native dropdowns work on mobile', async ({ browser, baseURL }) => {
  const context = await browser.newContext({javaScriptEnabled:false, viewport:{width:390,height:844}});
  const page = await context.newPage(); await page.goto(`${baseURL}/writing/`);
  const nav = page.getByRole('navigation', {name:'Main navigation'});
  await expect(nav).toBeVisible();
  await nav.getByLabel('Writing options').click();
  await expect(nav.getByRole('link',{name:'Historical Archive',exact:true})).toBeVisible();
  await nav.getByRole('link',{name:'Leadership',exact:true}).click(); await expect(page).toHaveURL('/leadership/');
  await context.close();
});

test('resizing an open mobile menu restores desktop links and resets disclosure state', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await page.goto('/writing/');
  await page.getByRole('button',{name:'Menu'}).click(); await page.getByLabel('Writing options').click();
  await page.setViewportSize({width:1440,height:900});
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Menu'})).toBeHidden();
  await expect(page.getByLabel('Writing options')).toHaveAttribute('aria-expanded','false');
});
