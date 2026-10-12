// Rebuild provisional icon assets from the same geometry used by BrandMark.astro.
import { mark } from '../src/identity/mark.ts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const tokens = JSON.parse(await readFile(new URL('../built_signal_v1/design/built-signal.tokens.json', import.meta.url)));
const out = new URL('../public/identity/', import.meta.url);
await mkdir(out, { recursive: true });
const rect = ({ x,y,width,height },fill) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`;
const geometry = (ink, stripe) => rect(mark.bar,ink)+rect(mark.stripe,stripe)+mark.paths.map(d=>`<path d="${d}" fill="${ink}"/>`).join('');
const svg = (content,viewBox='0 0 148 156') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${content}</svg>`;
const colors=tokens.referenceSwatches;
const icon=svg(`<rect width="192" height="192" rx="28" fill="${colors.navy}"/><g transform="translate(22 18)">${geometry(colors.ivory,colors.scarlet)}</g>`,'0 0 192 192');
await writeFile(new URL('favicon.svg',out),icon);
for(const theme of ['dark','light']){
 const ink=theme==='dark'?colors.ivory:colors.navy;
 await writeFile(new URL(`monogram-${theme}.svg`,out),svg(geometry(ink,colors.scarlet)));
 await writeFile(new URL(`lockup-${theme}.svg`,out),svg(`<g transform="translate(0 8) scale(.82)">${geometry(ink,colors.scarlet)}</g><g fill="${ink}" font-family="system-ui,sans-serif"><text x="140" y="84" font-size="66" font-weight="750" letter-spacing="-3">Ben Davis</text><text x="144" y="117" font-size="17" letter-spacing="5">BEN DAVIS BUILDS</text></g>`,'0 0 500 156'));
}
await writeFile(new URL('monogram-single-color.svg',out),svg(geometry(colors.navy,colors.navy)));
const browser=await chromium.launch();
try{
 for(const [size,name] of [[16,'favicon-16'],[32,'favicon-32'],[48,'favicon-48'],[180,'apple-touch-icon'],[192,'app-icon-192'],[512,'app-icon-512']]){
  const context=await browser.newContext({viewport:{width:size,height:size},deviceScaleFactor:1});const page=await context.newPage();
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{width:100%;height:100%;display:block}</style>${icon}`);
  await page.screenshot({path:new URL(`${name}.png`,out).pathname,omitBackground:true});await context.close();
 }
}finally{await browser.close()}
await writeFile(new URL('../public/site.webmanifest',import.meta.url),JSON.stringify({name:'Ben Davis Builds — Development',short_name:'Ben Davis',description:'Built Signal development template. Provisional identity and sample content.',start_url:'/',display:'browser',background_color:colors.navy,theme_color:colors.navy,icons:[{src:'/identity/app-icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/identity/app-icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'}]},null,2)+'\n');
console.log('Provisional SVG variants and six raster sizes generated from shared geometry.');
