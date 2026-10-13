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
  await writing.click(); await page.locator('.development-notice').click();
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

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1440]) {
  test(`navigation styling and overlay: ${theme} at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await page.addInitScript(theme => localStorage.setItem('built-signal-theme',theme),theme);
    await page.goto('/writing/');
    if(width<=1100) await page.getByRole('button',{name:'Menu'}).click();
    const nav=page.getByRole('navigation',{name:'Main navigation'});
    const links=nav.locator('.navigation-item > a');
    for(const link of await links.all()) {
      const style=await link.evaluate(el=>({underline:getComputedStyle(el).textDecorationLine,weight:getComputedStyle(el).fontWeight,size:getComputedStyle(el).fontSize,height:el.getBoundingClientRect().height}));
      expect(style.underline).toBe('none');expect(style.weight).toBe('500');expect(style.size).toBe('14px');expect(style.height).toBe(44);
    }
    const writing=nav.getByRole('link',{name:'Writing',exact:true});
    const indicator=await writing.evaluate(el=>({height:getComputedStyle(el,'::after').height,color:getComputedStyle(el,'::after').backgroundColor}));
    expect(indicator).toEqual({height:'2px',color:'rgb(232, 119, 34)'});
    const hero=await page.locator('.writing-hero').boundingBox();
    for(const label of ['Writing','Projects']) {
      const summary=nav.getByLabel(`${label} options`);
      const anchor=nav.getByRole('link',{name:label,exact:true});
      const icon=summary.locator('svg');
      const textBox=(await anchor.boundingBox())!;const iconBox=(await icon.boundingBox())!;
      expect(Math.abs(iconBox.x-(textBox.x+textBox.width)-6)).toBeLessThan(1);
      expect(Math.abs(iconBox.y+iconBox.height/2-(textBox.y+textBox.height/2))).toBeLessThan(1);
      await summary.click();
      await expect(summary).toHaveAttribute('aria-expanded','true');
      await expect.poll(() => icon.evaluate(el=>getComputedStyle(el).transform)).toBe('matrix(-1, 0, 0, -1, 0, 0)');
      for(const primary of await links.all()) expect(await primary.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
      const panel=nav.locator(`#${label.toLowerCase()}-destinations`);
      const box=(await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
      expect(await panel.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(30, 42, 58)');
      expect(await panel.evaluate(el=>el.contains(document.elementFromPoint(el.getBoundingClientRect().x+20,el.getBoundingClientRect().y+20)))).toBe(true);
      expect(await page.locator('.writing-hero').boundingBox()).toEqual(hero);
      for(const item of await panel.locator('a').all()) expect(await item.evaluate(el=>getComputedStyle(el).textDecorationLine)).toBe('none');
      const first=panel.locator('a').first();await page.keyboard.press('Tab');await expect(first).toBeFocused();
      expect(await first.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
      expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');await expect(summary).toBeFocused();
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
