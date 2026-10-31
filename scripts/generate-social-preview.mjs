// Build a sharing image from the existing approved icon and canonical tokens.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const tokens = JSON.parse(await readFile('built_signal_v1/design/built-signal.tokens.json', 'utf8')).referenceSwatches;
const icon = await sharp('public/identity/app-icon-512.png').resize(220, 220).toBuffer();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${tokens.navy}"/><rect x="72" y="100" width="4" height="430" fill="${tokens.scarlet}"/><text x="350" y="290" font-family="sans-serif" font-size="66" font-weight="700" fill="${tokens.ivory}">Ben Davis Builds</text><text x="353" y="350" font-family="sans-serif" font-size="24" fill="${tokens.ivory}">Technical leadership. Cybersecurity.</text><text x="353" y="392" font-family="sans-serif" font-size="24" fill="${tokens.ivory}">Always learning.</text><text x="353" y="485" font-family="sans-serif" font-size="20" fill="${tokens.brass}">bendavisbuilds.com</text></svg>`;
await writeFile('public/identity/og-default.png', await sharp(Buffer.from(svg)).composite([{ input: icon, left: 100, top: 195 }]).png().toBuffer());
