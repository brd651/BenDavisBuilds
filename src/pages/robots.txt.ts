import type { APIRoute } from 'astro';
import { robotsPolicy } from '../lib/crawler-policy';
export const GET: APIRoute = ({ site }) => new Response(robotsPolicy(site!.origin, import.meta.env.PUBLIC_NOINDEX === 'true'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
