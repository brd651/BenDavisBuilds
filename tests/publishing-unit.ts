import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublished, pageCount, pageEntries, plainText, readingMinutes, relatedScore, taxonomySlug } from '../src/lib/publishing-policy.ts';
import { escapeXml } from '../src/lib/xml.ts';
const now = Date.parse('2026-10-12T12:00:00Z');
test('publication eligibility excludes drafts and future dates at the UTC boundary', () => {
  assert.equal(isPublished({ draft: true, sample: true }, now), false);
  assert.equal(isPublished({ draft: false, sample: false }, now), false);
  assert.equal(isPublished({ draft: false, sample: true }, now), true);
  assert.equal(isPublished({ draft: false, sample: true, publishedAt: '2026-10-13' }, now), false);
  assert.equal(isPublished({ draft: false, sample: false, publishedAt: '2026-10-12' }, Date.parse('2026-10-11T23:59:59Z')), false);
  assert.equal(isPublished({ draft: false, sample: false, publishedAt: '2026-10-12' }, now), true);
});
test('reading/search prose strips imports, code, and markup while retaining link text', () => {
  const prose = plainText('import Diagram from "./Diagram";\n## A useful question\n[Details](/writing/)\n```js\nconst secretLookingCode = 1;\n```\n<Diagram />');
  assert.equal(prose, 'A useful question Details');
  assert.equal(readingMinutes(''), 1); assert.equal(readingMinutes(Array(441).fill('word').join(' ')), 3);
});
test('pagination has no empty trailing page and retains all entries in order', () => {
  assert.equal(pageCount(0), 1); assert.equal(pageCount(6), 1); assert.equal(pageCount(7), 2);
  const entries = Array.from({length:13},(_,i)=>i);
  assert.deepEqual([1,2,3].flatMap(page=>pageEntries(entries,page)),entries);
});
test('taxonomy URL normalization is deterministic', () => { assert.equal(taxonomySlug(' Systems & Clarity '), 'systems-clarity'); assert.equal(taxonomySlug('Café'), 'cafe'); });
test('related articles use shared topics with case-insensitive matching', () => { assert.equal(relatedScore({category:'Leadership',tags:['Trust']},{category:'leadership',tags:['trust','Systems']}),3); assert.equal(relatedScore({category:'Leadership',tags:[]},{category:'Engineering',tags:[]}),0); });
test('XML values escape unsafe characters without changing ordinary URLs', () => { assert.equal(escapeXml('"<a>&\''), '&quot;&lt;a&gt;&amp;&apos;'); });
