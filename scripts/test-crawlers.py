"""Exercise generated crawler artifacts with the standard robots parser."""
from pathlib import Path
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree
from html.parser import HTMLParser
import re
import unittest

ROOT = Path(__file__).resolve().parents[1] / 'dist'
ORIGIN = 'https://bendavisbuilds.com'

class Head(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.meta = {}
        self.canonical = None
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.meta[attrs.get('name', attrs.get('property'))] = attrs.get('content')
        elif tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonical = attrs.get('href')

class Crawlers(unittest.TestCase):
    def test_public_search_and_training_are_separate(self):
        parser = RobotFileParser()
        parser.parse((ROOT / 'robots.txt').read_text().splitlines())
        for bot in ['Googlebot', 'bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended']:
            for path in ['/', '/about/', '/leadership/', '/_astro/example.js']:
                self.assertTrue(parser.can_fetch(bot, ORIGIN + path), (bot, path))
            self.assertFalse(parser.can_fetch(bot, ORIGIN + '/api/contact'), bot)
            # Allow a crawler to read noindex metadata rather than hide it in robots.
            self.assertTrue(parser.can_fetch(bot, ORIGIN + '/about/test/'), bot)
        for bot in ['GPTBot', 'ClaudeBot']:
            self.assertFalse(parser.can_fetch(bot, ORIGIN + '/about/'), bot)
        self.assertEqual(parser.site_maps(), [ORIGIN + '/sitemap.xml'])

    def test_sitemap_and_ai_index_are_public_and_real(self):
        sitemap = ElementTree.fromstring((ROOT / 'sitemap.xml').read_text())
        urls = [node.text for node in sitemap.findall('.//{*}loc')]
        self.assertIn(ORIGIN + '/about/', urls)
        for url in urls:
            self.assertTrue(url.startswith(ORIGIN + '/'))
            path = url.removeprefix(ORIGIN).lstrip('/')
            head = Head((ROOT / path / 'index.html').read_text())
            self.assertEqual(head.meta['robots'], 'index, follow', url)
            self.assertEqual(head.canonical, url)
        llms = (ROOT / 'llms.txt').read_text()
        for url in re.findall(r'\]\((https://[^)]+)\)', llms):
            self.assertIn(url, urls)
        for text in ['about/test', '/lab/', 'labs.', 'sample/', 'technical-sample', 'Website-LocalDocs', 'AGENTS.md', '10.0.', 'draft-sentinel', '2999-']:
            self.assertNotIn(text, llms)
            self.assertNotIn(text, (ROOT / 'sitemap.xml').read_text())

    def test_non_public_pages_remain_readable_but_noindex(self):
        for path in ['about/test', 'lab', 'mentorship', 'writing/search', 'writing/sample', 'writing/technical-sample', 'writing/archive/sample']:
            head = Head((ROOT / path / 'index.html').read_text())
            self.assertEqual(head.meta['robots'], 'noindex, nofollow', path)
        for path in ['AGENTS.md', 'agents.txt', 'ai.txt', 'llms-full.txt', '.env']:
            self.assertFalse((ROOT / path).exists(), path)

if __name__ == '__main__':
    unittest.main(verbosity=2)
