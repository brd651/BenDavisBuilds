import type { APIRoute } from 'astro';
import { publishedEntries, searchEntry } from '../lib/publishing';
export const GET: APIRoute = async () => new Response(JSON.stringify((await publishedEntries()).map(searchEntry)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
