import test from 'node:test';
import assert from 'node:assert/strict';
import { homepageContentSchema, purchaseLink } from '../src/lib/homepage-content.ts';

test('missing optional curation produces no invented book, post or progress', () => {
  const data = homepageContentSchema.parse({ reading: {} });
  assert.deepEqual(data.reading.books, []);
  assert.deepEqual(data.socialPosts, []);
  assert.equal(data.labProgress, undefined);
  assert.throws(() => homepageContentSchema.parse({ reading: { currentBookId: 'missing' } }));
});
test('selected posts must use real network post routes and bounded excerpts', () => {
  for (const url of ['https://x.com/name', 'javascript:alert(1)', 'https://x.com.evil.test/name/status/123']) {
    assert.throws(() => homepageContentSchema.parse({ reading: {}, socialPosts: [{ platform: 'x', url, excerpt: 'Temporary test fixture.' }] }));
  }
  assert.equal(homepageContentSchema.parse({ reading: {}, socialPosts: [{ platform: 'x', url: 'https://x.com/name/status/123', excerpt: 'Temporary test fixture.' }] }).socialPosts.length, 1);
});
test('affiliate links require explicit opt-in, supported host and a configured tag', () => {
  const base = { id: 'fixture', title: 'Fixture book', author: 'Fixture author' };
  const ordinary = { ...base, purchase: { url: 'https://www.amazon.com/dp/EXAMPLE?tag=unapproved-20', amazonAffiliate: false } };
  assert(!purchaseLink(ordinary)?.href.includes('tag='));
  const affiliate = { ...ordinary, purchase: { ...ordinary.purchase, amazonAffiliate: true } };
  assert.equal(purchaseLink(affiliate), undefined);
  assert.equal(purchaseLink(affiliate, 'invalid'), undefined);
  assert.equal(purchaseLink({ ...affiliate, purchase: { ...affiliate.purchase, url: 'https://evil.test/book' } }, 'fixture-20'), undefined);
  const link = purchaseLink(affiliate, 'fixture-20');
  assert(link?.affiliate); assert.equal(link?.rel, 'sponsored noopener noreferrer');
  assert.equal(new URL(link!.href).searchParams.get('tag'), 'fixture-20');
});
