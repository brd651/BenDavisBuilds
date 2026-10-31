import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
declare global { interface Window { articleCLS: number } }
const articles = ['/writing/leadership-sample/', '/writing/technical-sample/', '/writing/archive/sample/', '/projects/sample/'];
for (const width of [320, 390, 768, 1440, 3840]) for (const theme of ['dark','light'] as const) {
  test(`publishing articles and discovery ${width}px ${theme}`, async ({ page, request }) => {
    await page.setViewportSize({width,height:width===3840?2160:1000});
    await page.addInitScript(mode=>localStorage.setItem('built-signal-theme',mode),theme);
    const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    for(const route of [...articles, '/writing/', '/writing/category/leadership/', '/writing/tag/systems/']) {
      expect((await page.goto(route))?.status()).toBe(200);
      await expect(page.locator('h1')).toHaveCount(1); await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(articles.includes(route)) {
        await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content','article');
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',`https://bendavisbuilds.com${route}`);
        await expect(page.getByText('Demonstration content.',{exact:true})).toBeVisible();
        const links=await page.locator('.article-toc a').evaluateAll(elements=>elements.map(el=>el.getAttribute('href')!));
        for(const href of links) await expect(page.locator(href)).toHaveCount(1);
        await expect(page.locator('.article-share')).toBeVisible();
        await expect(page.locator('.related-reading .article-card')).not.toHaveCount(0);
      }
      const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      expect(axe.violations,`${route} ${theme}`).toEqual([]);
    }
    await page.goto('/writing/technical-sample/');
    await expect(page.locator('.article-image source[type="image/avif"]')).toHaveAttribute('srcset',/480w.*768w.*1120w.*1600w/);
    await expect(page.locator('.article-image img')).toHaveAttribute('width','1600'); await expect(page.locator('.article-image img')).toHaveAttribute('height','700');
    expect(await page.locator('.article-image img').evaluate(image=>image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>0)).toBe(true);
    await expect(page.locator('.article-prose pre')).toHaveAttribute('tabindex','0');
    if(width <= 500) await expect(page.getByRole('list', {name:'Publishing flow'})).toBeVisible();
    await page.goto('/writing/archive/sample/'); await expect(page.getByLabel('Historical archive notice')).toBeVisible();
    await expect(page.locator('.article-meta time')).toHaveCount(0);
    for(const route of ['/rss.xml','/sitemap.xml','/search-index.json']) expect((await request.get(route)).status()).toBe(200);
    expect(errors).toEqual([]);
  });
}
test('metadata, generated index and feed agree on published article routes',async({page,request})=>{
  const entries=await (await request.get('/search-index.json')).json();
  expect(entries).toHaveLength(5); const sitemap=await(await request.get('/sitemap.xml')).text(); const rss=await(await request.get('/rss.xml')).text();
  for(const entry of entries) { expect(sitemap).not.toContain(`https://bendavisbuilds.com${entry.url}`); expect(rss).toContain(`https://bendavisbuilds.com${entry.url}`); expect((await request.get(entry.url)).status()).toBe(200); }
  await page.goto('/writing/technical-sample/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content',/^https:\/\/bendavisbuilds.com\/_astro\/.+\.webp$/);
  expect(rss).not.toContain('<pubDate>'); expect(sitemap).not.toContain('/404/');
  await expect(page.locator('.article-share a').first()).toHaveAttribute('href',/url=https%3A%2F%2Fbendavisbuilds.com%2Fwriting%2Ftechnical-sample%2F/);
});
test('article search filters prose, retains keyboard links and recovers on clear',async({page})=>{
  await page.goto('/writing/search/'); await page.getByLabel('Search articles by topic, title, or text').fill('professional experience');
  await expect(page.locator('#search-status')).toHaveText('1 article found.'); await expect(page.locator('.search-results a')).toHaveText('Demonstration: making room for better questions');
  const first=page.locator('.search-results a'); await first.focus(); expect(await first.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter'); await expect(page).toHaveURL('/writing/leadership-sample/');
  await page.goto('/writing/search/'); await page.locator('#article-query').fill('does-not-exist'); await expect(page.locator('#search-status')).toHaveText('0 articles found.');
  await page.locator('#article-query').fill(''); await expect(page.locator('.search-fallback')).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});
test('optional MDX module loads only on opening and ordinary posts ship no React',async({page})=>{
  const scripts:string[]=[]; page.on('request',r=>{if(r.resourceType()==='script')scripts.push(r.url());});
  await page.goto('/writing/technical-sample/'); expect(scripts.some(url=>/reading-demo\./.test(url))).toBe(false);
  await page.getByText('Optional interactive example: estimate reading time',{exact:true}).click();
  await expect(page.getByLabel('Article word count')).toBeVisible(); await page.getByLabel('Article word count').fill('880');
  await expect(page.locator('[data-estimate]')).toHaveText('Estimated reading time: 4 minutes.'); expect(scripts.some(url=>/reading-demo\./.test(url))).toBe(true);
  expect(scripts.some(url=>/react(?:-dom)?|jsx-runtime/i.test(url))).toBe(false);
  scripts.length=0; await page.goto('/writing/leadership-sample/'); expect(scripts.some(url=>/ReadingTimeDemo|reading-demo|react/i.test(url))).toBe(false);
});
test('reading, contents anchors and search fallback survive no JS and text reflow',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:900},reducedMotion:'reduce'});
  await context.route('**/writing/**',async route=>{const response=await route.fetch(); if(response.headers()['content-type']?.includes('text/html')) await route.fulfill({response,body:(await response.text()).replace('</head>','<style>html{font-size:200%}</style></head>')});else await route.fulfill({response});});
  const page=await context.newPage();
  for(const route of articles) { await page.goto(route); await expect(page.locator('h1')).toBeVisible(); await expect(page.locator('.article-prose')).toBeVisible(); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true); }
  await page.goto('/writing/technical-sample/'); await page.getByText('Optional interactive example: estimate reading time',{exact:true}).click(); await expect(page.locator('[data-fallback]')).toBeVisible(); await expect(page.locator('[data-controls]')).toBeHidden();
  await page.goto('/writing/search/'); await expect(page.locator('.search-fallback .article-card')).toHaveCount(5); await expect(page.locator('.search-controls')).toBeHidden();
  await context.close();
});
test('article anchors focus their destinations and image dimensions avoid layout shift',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>{window.articleCLS=0; new PerformanceObserver(list=>{for(const entry of list.getEntries()){const shift=entry as PerformanceEntry & {hadRecentInput:boolean;value:number}; if(!shift.hadRecentInput)window.articleCLS+=shift.value;}}).observe({type:'layout-shift',buffered:true});});
  await page.goto('/writing/technical-sample/'); await page.locator('.article-image img').evaluate(async image=>{await(image as HTMLImageElement).decode();});
  expect(await page.evaluate(()=>window.articleCLS)).toBeLessThan(0.1);
  const link=page.getByRole('navigation',{name:'In this article'}).getByRole('link',{name:'Keep the source small'}); await link.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#keep-the-source-small$/); await expect(page.locator('#keep-the-source-small')).toBeFocused(); await expect.poll(()=>page.locator('#keep-the-source-small').evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
});
