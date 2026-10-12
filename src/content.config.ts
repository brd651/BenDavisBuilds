import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { publishingSchema } from './lib/content-schema';
const loader = (base: string) => glob({ pattern: '**/*.{md,mdx}', base, generateId: ({ entry }) => entry.replace(/\.(md|mdx)$/, '') });
export const collections = {
  leadership: defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/leadership' }), schema: z.object({ title: z.string().min(1), description: z.string().min(1), subtitle: z.string().min(1), draft: z.boolean(), contentVersion: z.string().min(1) }) }),
  writing: defineCollection({ loader: loader('./src/content/writing'), schema: publishingSchema }),
  archive: defineCollection({ loader: loader('./src/content/archive'), schema: context => publishingSchema(context, true) }),
  projects: defineCollection({ loader: loader('./src/content/projects'), schema: publishingSchema }),
};
