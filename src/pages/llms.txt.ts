import type { APIRoute } from 'astro';
import { articleUrl, indexableUrls, publishedEntries } from '../lib/publishing';
const pages: Record<string, string> = {
  '/': 'Ben Davis Builds: technical leadership, hands-on engineering and ongoing learning.',
  '/about/': 'About Ben Davis: verified career progression, technical lessons and TheoryIT history.',
  '/leadership/': 'Leadership philosophy: five people-leadership principles and the Does It Scale? operating question.',
  '/writing/': 'Writing and field notes. Demonstration entries are labeled and are not genuine professional publications.',
  '/writing/archive/': 'Historical archive. Older technical material may be obsolete; demonstrations are labeled.',
  '/projects/': 'Public projects and experiments. Demonstrations are labeled.',
  '/mentorship/': 'Mentorship and professional development.',
  '/contact/': 'Contact Ben Davis.',
};
export const GET: APIRoute = async ({ site }) => {
  if (import.meta.env.PUBLIC_NOINDEX === 'true') return new Response('# Ben Davis Builds\n\nDiscovery is disabled for this preview build.\n');
  const urls = new Set(await indexableUrls());
  const entries = (await publishedEntries()).filter(entry => !entry.data.sample && urls.has(articleUrl(entry)));
  const clean = (value: string) => value.replace(/[\r\n\[\]]/g, ' ');
  const body = '# Ben Davis Builds\n\n> Technical leadership, cybersecurity, hands-on engineering, and lessons from Ben Davis.\n\nThis is a curated public reading index, not an access-control or training-permission file. Refer to robots.txt for crawler policy. Dates and achievements should only be attributed when explicitly stated in the linked source.\n\n## Public pages\n\n' + Object.entries(pages).filter(([url]) => urls.has(url)).map(([url, text]) => `- [${url === '/' ? 'Home' : url.split('/').filter(Boolean).join(' / ')}](${new URL(url, site)}): ${text}`).join('\n') + (entries.length ? '\n\n## Published writing and projects\n\n' + entries.map(entry => `- [${clean(entry.data.title)}](${new URL(articleUrl(entry), site)}): ${clean(entry.data.description)}`).join('\n') : '') + '\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
