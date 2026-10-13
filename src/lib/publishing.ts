import { getCollection, type CollectionEntry } from 'astro:content';
import { isPublished, latestWritingEntries, pageCount, plainText, readingMinutes, relatedScore, taxonomySlug } from './publishing-policy';
export type PublishingCollection = 'writing' | 'archive' | 'projects';
export type ArticleEntry = CollectionEntry<PublishingCollection>;
export const collectionBases = { writing: '/writing/', archive: '/writing/archive/', projects: '/projects/' } as const;
export const collectionNames = { writing: 'Writing', archive: 'Historical Archive', projects: 'Projects' } as const;
const buildTime = Date.now();
export async function publishedEntries(collection?: PublishingCollection): Promise<ArticleEntry[]> {
  const entries: ArticleEntry[] = collection ? await getCollection(collection) : (await Promise.all([getCollection('writing'), getCollection('archive'), getCollection('projects')])).flat();
  for (const entry of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(entry.id) || ['archive', 'category', 'tag', 'page', 'search'].includes(entry.id.split('/')[0]!)) throw new Error(`Invalid or reserved article filename: ${entry.collection}/${entry.id}. Use lowercase kebab-case paths; archive/category/tag/page/search are reserved.`);
  }
  return entries.filter(entry => isPublished(entry.data, buildTime)).sort((a, b) => (b.data.publishedAt ?? '').localeCompare(a.data.publishedAt ?? '') || a.id.localeCompare(b.id) || a.collection.localeCompare(b.collection));
}
export function articleUrl(entry: ArticleEntry): string { return `${collectionBases[entry.collection]}${entry.id}/`; }
export function formatDate(value: string): string { return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)); }
export function taxonomies(entries: ArticleEntry[], field: 'category' | 'tags'): { label: string; slug: string; entries: ArticleEntry[] }[] {
  const groups = new Map<string, { label: string; slug: string; entries: ArticleEntry[] }>();
  for (const entry of entries) for (const label of field === 'category' ? [entry.data.category] : entry.data.tags) {
    const slug = taxonomySlug(label); const existing = groups.get(slug);
    if (!slug || (existing && existing.label.toLowerCase() !== label.toLowerCase())) throw new Error(`Ambiguous ${field} label "${label}". Use distinct URL-friendly taxonomy names.`);
    if (existing) existing.entries.push(entry); else groups.set(slug, { label, slug, entries: [entry] });
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
export async function relatedEntries(entry: ArticleEntry): Promise<ArticleEntry[]> { return (await publishedEntries()).filter(other => articleUrl(other) !== articleUrl(entry) && relatedScore(entry.data, other.data) > 0).sort((a, b) => relatedScore(entry.data, b.data) - relatedScore(entry.data, a.data)).slice(0, 3); }
export async function publicUrls(): Promise<string[]> {
  const entries = await publishedEntries();
  const urls = ['/', '/about/', '/leadership/', '/writing/', '/writing/archive/', '/projects/', '/lab/', '/mentorship/', '/contact/'];
  urls.push(...entries.map(articleUrl));
  for (const field of ['category', 'tags'] as const) for (const group of taxonomies(entries, field)) {
    const base = `/writing/${field === 'category' ? 'category' : 'tag'}/${group.slug}/`;
    urls.push(base); for (let p = 2; p <= pageCount(group.entries.length); p++) urls.push(`${base}page/${p}/`);
  }
  for (const collection of ['writing', 'archive', 'projects'] as const) {
    const collectionEntries = entries.filter(e => e.collection === collection);
    const listingEntries = collection === 'writing' ? latestWritingEntries(collectionEntries) : collectionEntries;
    for (let p = 2; p <= pageCount(listingEntries.length); p++) urls.push(`${collectionBases[collection]}page/${p}/`);
  }
  return [...new Set(urls)];
}
export function searchEntry(entry: ArticleEntry) { return { url: articleUrl(entry), title: entry.data.title, description: entry.data.description, category: entry.data.category, tags: entry.data.tags, collection: collectionNames[entry.collection], sample: entry.data.sample, text: plainText(entry.body ?? ''), readingMinutes: readingMinutes(entry.body ?? '') }; }
