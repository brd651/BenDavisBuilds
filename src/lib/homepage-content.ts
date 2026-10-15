import { z } from 'astro/zod';
import type { ImageMetadata } from 'astro';

const httpsUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use a full HTTPS URL without credentials.');
const socialPost = z.object({
  platform: z.enum(['linkedin', 'x']),
  url: httpsUrl,
  excerpt: z.string().trim().min(1).max(400),
}).refine(post => {
  const url = new URL(post.url);
  return post.platform === 'linkedin'
    ? ['linkedin.com', 'www.linkedin.com'].includes(url.hostname) && /^\/(posts\/[^/]+|feed\/update\/urn:li:activity:\d+)\/?$/.test(url.pathname)
    : ['x.com', 'www.x.com'].includes(url.hostname) && /^\/[^/]+\/status\/\d+\/?$/.test(url.pathname);
}, 'Use an actual post URL for the selected network.');
const book = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  author: z.string().trim().min(1),
  cover: z.object({
    image: z.custom<ImageMetadata>(value => !!value && typeof value === 'object' && 'src' in value && 'width' in value && 'height' in value && Number(value.width) > 0 && Number(value.height) > 0, 'Import a local image through Astro.'),
    alt: z.string().trim().min(1),
  }).optional(),
  takeaway: z.string().trim().min(1).optional(),
  purchase: z.object({ url: httpsUrl, amazonAffiliate: z.boolean().default(false) }).optional(),
});
export const homepageContentSchema = z.object({
  labProgress: z.object({
    kind: z.enum(['current-focus', 'verified-milestone', 'next-step']),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    reviewedAt: z.iso.date().optional(),
  }).optional(),
  socialPosts: z.array(socialPost).max(2).default([]).refine(posts => new Set(posts.map(post => post.platform)).size === posts.length, 'Select at most one post per network.'),
  reading: z.object({
    books: z.array(book).default([]),
    currentBookId: z.string().optional(),
    amazonAssociateTag: z.string().regex(/^[A-Za-z0-9_-]{1,60}-\d{2,3}$/).optional(),
  }).superRefine((reading, ctx) => {
    if (new Set(reading.books.map(book => book.id)).size !== reading.books.length) ctx.addIssue({ code: 'custom', message: 'Book IDs must be unique.' });
    if (reading.currentBookId && !reading.books.some(book => book.id === reading.currentBookId)) ctx.addIssue({ code: 'custom', message: 'Current book must reference a configured entry.' });
  }),
});
export type HomepageContent = z.infer<typeof homepageContentSchema>;
export type ReadingEntry = HomepageContent['reading']['books'][number];

/** No tracking tag is passed through without explicit, valid affiliate configuration. */
export function purchaseLink(book: ReadingEntry, tag?: string) {
  if (!book.purchase) return undefined;
  const url = new URL(book.purchase.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'amzn.to') return undefined;
  url.searchParams.delete('tag');
  if (book.purchase.amazonAffiliate) {
    if (!tag || !/^[A-Za-z0-9_-]{1,60}-\d{2,3}$/.test(tag) || !['amazon.com', 'www.amazon.com'].includes(url.hostname)) return undefined;
    url.searchParams.set('tag', tag);
    return { href: url.href, rel: 'sponsored noopener noreferrer', affiliate: true };
  }
  return { href: url.href, rel: 'noopener noreferrer', affiliate: false };
}
