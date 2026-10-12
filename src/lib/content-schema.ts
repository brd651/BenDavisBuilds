import { z } from 'astro/zod';
import type { SchemaContext } from 'astro:content';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date: YYYY-MM-DD.').refine(value => { const time = Date.parse(`${value}T00:00:00Z`); return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value; }, 'Use a valid calendar date.');
const label = z.string().trim().min(1).max(60).refine(value => /[A-Za-z0-9]/.test(value), 'Categories and tags need a letter or number.');
export function publishingSchema({ image }: SchemaContext, archive = false) {
  return z.object({
    title: z.string().trim().min(1).max(140), description: z.string().trim().min(1).max(300),
    category: label, tags: z.array(label).max(12).default([]),
    draft: z.boolean().default(false), sample: z.boolean().default(false),
    publishedAt: date.optional(), updatedAt: date.optional(), author: z.string().trim().min(1).max(80).optional(),
    image: image().optional(), imageAlt: z.string().trim().min(1).max(240).optional(), imageCaption: z.string().trim().min(1).max(300).optional(),
    ...(archive ? { historical: z.literal(true), originalSource: z.url({ protocol: /^https?$/ }).optional() } : {}),
  }).strict().superRefine((data, context) => {
    if (!data.draft && !data.sample && !data.publishedAt) context.addIssue({ code: 'custom', path: ['publishedAt'], message: 'A genuine published post requires publishedAt. For an undated demonstration set sample: true.' });
    if (data.updatedAt && (!data.publishedAt || data.updatedAt < data.publishedAt)) context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updatedAt requires publishedAt and must not precede it.' });
    if (data.image && !data.imageAlt) context.addIssue({ code: 'custom', path: ['imageAlt'], message: 'Provide meaningful imageAlt for the article image.' });
    if (!data.image && (data.imageAlt || data.imageCaption)) context.addIssue({ code: 'custom', path: ['image'], message: 'Image text requires a local image.' });
    if (new Set(data.tags.map(tag => tag.toLowerCase())).size !== data.tags.length) context.addIssue({ code: 'custom', path: ['tags'], message: 'Tags must be unique (case-insensitive).' });
  });
}
