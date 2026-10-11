import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const sampleSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  sample: z.literal(true),
  category: z.string().min(1),
});

export const collections = {
  writing: defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/writing' }), schema: sampleSchema }),
  archive: defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/archive' }), schema: sampleSchema.extend({ historical: z.literal(true) }) }),
  projects: defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/projects' }), schema: sampleSchema }),
};
