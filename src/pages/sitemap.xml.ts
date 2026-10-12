import type { APIRoute } from 'astro';
import { publicUrls } from '../lib/publishing';
import { escapeXml } from '../lib/xml';
export const GET: APIRoute = async ({ site }) => new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${(await publicUrls()).map(path => `<url><loc>${escapeXml(new URL(path, site).href)}</loc></url>`).join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
