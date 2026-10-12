import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { publishedEntries, articleUrl, collectionNames } from '../lib/publishing';
export const GET: APIRoute = async ({ site }) => rss({
  title: 'Ben Davis Builds / Writing and Projects', description: 'Writing, historical archives, and projects. Demonstration entries are explicitly labeled.', site: site!,
  items: (await publishedEntries()).map(entry => ({ title: `${entry.data.sample ? '[Demonstration] ' : ''}${entry.data.title}`, description: entry.data.description, link: articleUrl(entry), pubDate: entry.data.publishedAt ? new Date(`${entry.data.publishedAt}T00:00:00Z`) : undefined, categories: [collectionNames[entry.collection], entry.data.category, ...entry.data.tags] })),
});
