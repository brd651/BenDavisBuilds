import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1440, 3840]) {
  test(`About wave, depth and readable hover ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(t => localStorage.setItem('built-signal-theme', t), theme);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/about/');
    await page.locator('#sonicwall').scrollIntoViewIfNeeded();
    const timeline = page.locator('[data-career-timeline]');
    await expect(timeline).toHaveAttribute('data-motion', 'true');
    await expect(page.locator('#sonicwall')).toHaveClass(/is-current/);
    const path = page.locator('.timeline-connector path').first();
    const before = await path.getAttribute('d');
    const displacement = () => page.locator('.career-stage').evaluateAll(stages => stages.map(stage => ['.milestone', '.stage-identity', '.stage-story'].map(selector => {
      const matrix = new DOMMatrix(getComputedStyle(stage.querySelector(selector)!).transform);
      return { x: matrix.m41, y: matrix.m42 };
    })));
    const positionsBefore = await displacement();
    await page.evaluate(() => scrollBy(0, 100));
    await expect.poll(() => path.getAttribute('d')).not.toBe(before);
    const positionsAfter = await displacement();
    expect(positionsAfter.some((parts, index) => Math.abs(parts[0].y - positionsBefore[index][0].y) > 1)).toBe(true);
    for (const parts of positionsAfter) {
      expect(parts.every(part => Math.abs(part.x) < .01)).toBe(true);
      expect(Math.abs(parts[0].y - parts[1].y)).toBeLessThan(.01);
      expect(Math.abs(parts[0].y - parts[2].y)).toBeLessThan(.01);
    }
    // Every straight connector meets both vertically moving markers, including on narrow screens.
    const joins = await timeline.evaluate(root => {
      const stages = [...root.querySelectorAll('.career-stage')];
      return stages.slice(0, -1).map((stage, i) => {
        const line = stage.querySelector<SVGPathElement>('path')!;
        const matrix = line.getScreenCTM()!;
        const start = line.getPointAtLength(0).matrixTransform(matrix);
        const end = line.getPointAtLength(line.getTotalLength()).matrixTransform(matrix);
        const first = stage.querySelector('.milestone')!.getBoundingClientRect();
        const next = stages[i+1].querySelector('.milestone')!.getBoundingClientRect();
        return [Math.hypot(start.x-first.left-first.width/2,start.y-first.top-first.height/2), Math.hypot(end.x-next.left-next.width/2,end.y-next.top-next.height/2)];
      });
    });
    expect(joins.flat().every(distance => distance < 1)).toBe(true);
    await page.locator('#sonicwall summary').hover();
    await expect.poll(() => page.locator('#sophos .stage-story').evaluate(el => Number(getComputedStyle(el).opacity))).toBeCloseTo(.68, 2);
    await expect.poll(() => page.locator('#sophos .stage-identity').evaluate(el => Number(getComputedStyle(el).opacity))).toBeCloseTo(.68, 2);
    await expect(page.locator('#sonicwall')).toHaveClass(/is-current/);
    await page.keyboard.press('Tab');
    await page.locator('#sonicwall summary').focus();
    await page.locator('#sophos .stage-organization').hover();
    await expect(page.locator('#sonicwall')).toHaveClass(/is-current/);
    await expect.poll(() => page.locator('#sonicwall .stage-story').evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))).toEqual([]);
    await expect(page.locator('[data-timeline-motion]')).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.locator('#sonicwall summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sonicwall details')).toHaveAttribute('open', '');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(timeline).toHaveAttribute('data-motion', 'false');
    await expect(page.locator('[data-timeline-motion]')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('Wave is idle without scrolling and optional code stays out of reduced-motion visits', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', request => { if (request.url().includes('career-motion.')) chunks.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/about/');
  await page.locator('#sonicwall').scrollIntoViewIfNeeded();
  expect(chunks).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('[data-career-timeline]')).toHaveAttribute('data-motion', 'true');
  await expect.poll(() => chunks.length).toBe(1);
  // An observed path cannot mutate when the scroll-driven animation is idle.
  const mutations = await page.locator('.timeline-connector').first().evaluate(async rail => {
    await new Promise(resolve => setTimeout(resolve, 450));
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(rail, { subtree: true, attributes: true });
    await new Promise(resolve => setTimeout(resolve, 350));
    observer.disconnect();
    return count;
  });
  expect(mutations).toBe(0);
});

test('Failed motion download leaves native timeline and disclosures usable', async ({ page }) => {
  await page.route('**/career-motion.*.js', route => route.abort());
  await page.goto('/about/');
  await page.locator('#sonicwall').scrollIntoViewIfNeeded();
  await page.locator('#sonicwall summary').click();
  await expect(page.locator('#sonicwall .stage-detail')).toBeVisible();
  await expect(page.locator('[data-career-timeline]')).toHaveAttribute('data-motion', 'false');
  await expect(page.locator('[data-timeline-motion]')).toBeHidden();
});

test('Wave stops rewriting paths outside the viewport and resumes on return', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 768 });
  await page.goto('/about/');
  await page.locator('#sonicwall').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-career-timeline]')).toHaveAttribute('data-motion', 'true');
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => page.locator('[data-career-timeline]').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(868);
  // Wait for IntersectionObserver delivery, then scroll while still outside its margin.
  await page.waitForTimeout(100);
  const path = page.locator('.timeline-connector path').first();
  const before = await path.getAttribute('d');
  await page.evaluate(() => scrollTo(0, 25));
  await page.waitForTimeout(100);
  await expect(path).toHaveAttribute('d', before!);
  await page.locator('#palo-alto-networks').scrollIntoViewIfNeeded();
  await expect.poll(() => path.getAttribute('d')).not.toBe(before);
});

for (const theme of ['dark', 'light']) for (const fallback of ['reduced-motion', 'no-javascript', 'missing-observer']) {
  test(`Hover visibly fades peers with ${fallback} in ${theme}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      javaScriptEnabled: fallback !== 'no-javascript',
      reducedMotion: fallback === 'reduced-motion' ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    if (fallback === 'missing-observer') await page.addInitScript(() => { Reflect.deleteProperty(window, 'ResizeObserver'); });
    await page.goto(`${baseURL}/about/`);
    // This also sets a theme without relying on the unavailable site scripts.
    await page.locator('html').evaluate((root, theme) => root.setAttribute('data-theme', theme), theme);
    await page.locator('#sonicwall .stage-story h3').hover();
    await expect.poll(() => page.locator('#sophos .stage-story').evaluate(el => Number(getComputedStyle(el).opacity))).toBeCloseTo(.68, 2);
    await expect.poll(() => page.locator('#sophos .stage-identity').evaluate(el => Number(getComputedStyle(el).opacity))).toBeCloseTo(.68, 2);
    await expect.poll(() => page.locator('#sonicwall .stage-story').evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
    // Axe itself needs JavaScript; the no-JS case verifies native CSS state directly.
    if (fallback !== 'no-javascript') {
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(axe.violations, JSON.stringify(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))).toEqual([]);
    }
    await page.mouse.move(0, 0);
    await expect.poll(() => page.locator('#sophos .stage-story').evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
    await context.close();
  });
}
