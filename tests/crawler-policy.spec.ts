import { test, expect } from '@playwright/test';

test('Public SEO and AI discovery exclude experiments and demonstration content', async ({ page, request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('User-agent: *\nDisallow: /api/');
  expect(robots).toContain('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /');
  expect(robots).not.toContain('User-agent: OAI-SearchBot'); // inherits shared restrictions
  expect(robots).toContain('Sitemap: https://bendavisbuilds.com/sitemap.xml');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const llms = await (await request.get('/llms.txt')).text();
  for (const forbidden of ['/about/test', '/lab/', 'sample/', 'technical-sample', 'labs.', '10.0.', 'AGENTS.md', 'Website-LocalDocs', '2999-', 'draft-sentinel']) {
    expect(sitemap).not.toContain(forbidden);
    expect(llms).not.toContain(forbidden);
  }
  expect(sitemap).toContain('https://bendavisbuilds.com/about/');
  expect(llms).toContain('https://bendavisbuilds.com/leadership/');
  for (const route of ['/', '/about/', '/leadership/', '/contact/']) {
    expect((await page.goto(route))?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://bendavisbuilds.com${route}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `https://bendavisbuilds.com${route}`);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect((await request.get(new URL(image!).pathname)).status()).toBe(200);
    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(schemas).toHaveLength(1);
    expect(JSON.parse(schemas[0])['@graph'].some((item: { '@type': string }) => item['@type'] === (route === '/about/' ? 'AboutPage' : 'WebPage'))).toBe(true);
  }
  for (const route of ['/about/test/', '/lab/', '/mentorship/', '/writing/', '/writing/archive/', '/projects/', '/writing/search/', '/writing/sample/', '/writing/technical-sample/', '/writing/archive/sample/']) {
    expect((await page.goto(route))?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  }
  for (const route of ['/AGENTS.md', '/agents.txt', '/ai.txt', '/llms-full.txt', '/.env']) expect((await request.get(route)).status()).toBe(404);
});
