import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { satteri } from '@astrojs/markdown-satteri';
import { articleHeadings } from './scripts/article-headings.mjs';
export default defineConfig({
  output: 'static', site: process.env.SITE_URL || 'https://bendavisbuilds.com', trailingSlash: 'always',
  build: { inlineStylesheets: 'never' }, integrations: [mdx()],
  markdown: { processor: satteri({ hastPlugins: [articleHeadings] }), shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false, wrap: false } },
});
