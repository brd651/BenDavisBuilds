import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const theme of ['dark', 'light']) for (const [width, height] of [[390,844],[768,1024],[1366,768],[1440,900],[1920,1080],[2560,1440],[3840,2160]]) {
  test(`editorial homepage ${theme} ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(t => localStorage.setItem('built-signal-theme', t), theme);
    const telemetry: string[] = [];page.on('request',r=>{if(r.url().includes('/api/telemetry'))telemetry.push(r.url())});
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Systems for a more interesting tomorrow.');
    await expect(page.locator('.hero-support')).toHaveText('Leading teams, building things, and sharing what I learn.');
    await expect(page.locator('.built-hero a')).toHaveCount(0);
    const headings = await page.locator('main h2').allTextContents();
    expect(headings).toEqual(['Different paths.The same curiosity.', "What I'm working through.", 'What has my attention.', "Curiosity doesn't switch off."]);
    expect(await page.locator('body').innerText()).not.toMatch(/lorem ipsum|\bsample\b|development preview|simulated lab/i);
    await expect(page.getByText('Reading list in progress.', { exact: true })).toBeVisible();
    await expect(page.locator('.social-note')).toHaveCount(2);
    expect(await page.locator('.social-note a').evaluateAll(nodes=>nodes.map(a=>a.getAttribute('href')))).toEqual(['https://www.linkedin.com/in/brd651/', 'https://x.com/BenDavis651']);
    await expect(page.locator('iframe, .book-cover, a[rel~="sponsored"]')).toHaveCount(0);
    const links = await page.locator('main a[href^="/"]').evaluateAll(nodes=>[...new Set(nodes.map(a=>a.getAttribute('href')!))]);
    for(const href of links) expect((await request.get(href.split('#')[0]!)).status()).toBe(200);
    const footer=page.getByRole('contentinfo');await expect(footer.locator('#privacy-notice summary')).toBeVisible();
    await footer.locator('#privacy-notice summary').click();await expect(footer.locator('.privacy-copy')).toBeVisible();
    expect(telemetry).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  });
}
test('footer consent remains default-off, accessible and reversible on homepage', async ({page})=>{
 const batches:unknown[]=[];await page.route('**/api/telemetry',async route=>{batches.push(JSON.parse(route.request().postData()!));await route.fulfill({status:204})});
 await page.goto('/');const preferences=page.locator('footer #analytics-preferences');test.skip(await preferences.count()===0,'Analytics disabled in this build.');
 await preferences.locator('summary').focus();await page.keyboard.press('Enter');
 await expect(preferences.getByRole('button',{name:'Off',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(batches).toEqual([]);await preferences.getByRole('button',{name:'Session only',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect.poll(()=>batches.length).toBe(1);
 await preferences.getByRole('button',{name:'Off',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));expect(batches.length).toBe(1);
 await expect(preferences).toContainText('Do Not Track and Global Privacy Control');
});
