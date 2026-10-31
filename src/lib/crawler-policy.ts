// Public discovery is independent from access control and model-training permission.
export const publicPages = ['/', '/about/', '/leadership/', '/contact/'] as const;
export const nonIndexablePaths = ['/about/test', '/lab', '/writing/search', '/api/', '/health.txt', '/analytics-routes.json', '/search-index.json'];
export function robotsPolicy(origin: string, preview: boolean): string {
  if (preview) return 'User-agent: *\nDisallow: /\n';
  // Search and user-directed retrieval inherit the same path restrictions. Do not
  // add broad named Allow groups: they would override wildcard path exclusions.
  return `# Search and user-directed AI retrieval may discover public content.\nUser-agent: *\n${nonIndexablePaths.filter(path => !path.startsWith('/about/test') && !path.startsWith('/lab') && path !== '/writing/search').map(path => `Disallow: ${path}`).join('\n')}\nAllow: /\n\n# Permit fetching non-indexable HTML so crawlers can see its noindex metadata.\n# Training-only agents are separate from search agents.\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}
