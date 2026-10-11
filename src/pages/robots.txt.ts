import type { APIRoute } from 'astro';
export const GET: APIRoute = () => new Response(import.meta.env.PUBLIC_NOINDEX !== 'false' ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain' } });
