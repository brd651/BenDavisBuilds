export interface Publication { draft: boolean; sample: boolean; publishedAt?: string }
export const PAGE_SIZE = 6;
export function isPublished(data: Publication, now = Date.now()): boolean {
  return !data.draft && (data.sample || Boolean(data.publishedAt)) && (!data.publishedAt || Date.parse(`${data.publishedAt}T00:00:00Z`) <= now);
}
export function plainText(markdown: string): string {
  return markdown.replace(/^(?:import|export)\s.*$/gm, '').replace(/```[\s\S]*?```/g, '').replace(/<[^>]*>/g, ' ').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*_`>~]/g, '').replace(/\s+/g, ' ').trim();
}
export function readingMinutes(body: string): number { return Math.max(1, Math.ceil(plainText(body).split(/\s+/).filter(Boolean).length / 220)); }
export function taxonomySlug(label: string): string { return label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
export function pageCount(count: number): number { return Math.max(1, Math.ceil(count / PAGE_SIZE)); }
export function pageEntries<T>(entries: T[], page: number): T[] { return entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE); }
// Select from already-published Writing entries; never promote the first item implicitly.
export function featuredEntry<T extends { data: { featured: boolean } }>(entries: T[]): T | undefined {
  const selected = entries.filter(entry => entry.data.featured);
  if (selected.length > 1) throw new Error('Only one published Writing article may have featured: true. Clear the previous selection before featuring another article.');
  return selected[0];
}
export function latestWritingEntries<T extends { data: { featured: boolean } }>(entries: T[]): T[] {
  const selected = featuredEntry(entries);
  return entries.filter(entry => entry !== selected);
}
export function relatedScore(a: { category: string; tags: string[] }, b: { category: string; tags: string[] }): number { return (a.category.toLowerCase() === b.category.toLowerCase() ? 2 : 0) + a.tags.filter(tag => b.tags.some(other => other.toLowerCase() === tag.toLowerCase())).length; }
