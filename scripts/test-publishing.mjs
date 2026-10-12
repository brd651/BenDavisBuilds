// Exercise real Astro loader/schema/routes in an isolated source copy.
import { mkdtemp, cp, symlink, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const source = process.cwd();
const work = await mkdtemp(join(tmpdir(), 'built-signal-publishing-check-'));
const build = () => spawnSync(process.execPath, [resolve(source,'node_modules/astro/bin/astro.mjs'), 'build'], { cwd: work, env: {...process.env, ASTRO_TELEMETRY_DISABLED:'1'}, encoding:'utf8', maxBuffer: 8 * 1024 * 1024 });
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function textFiles(dir) { const result=[]; for(const entry of await readdir(dir,{withFileTypes:true})) { const path=join(dir,entry.name); if(entry.isDirectory()) result.push(...await textFiles(path)); else if(/\.(html|xml|json|js)$/.test(path)) result.push(path); } return result; }
function fixture(title, extra='') { return `---\ntitle: "${title}"\ndescription: "An automated acceptance fixture, not public editorial material."\ncategory: Acceptance fixture\ntags: [acceptance-fixture]\nsample: true\n${extra}---\n\n## Automatic route\n\nA temporary file tests the actual content loader.\n`; }
try {
  for (const path of ['src','scripts','public','design/artwork','astro.config.mjs','tsconfig.json','package.json','package-lock.json','built_signal_v1/design']) await cp(resolve(source,path),resolve(work,path),{recursive:true});
  await symlink(resolve(source,'node_modules'),resolve(work,'node_modules'),'dir');
  for (const collection of ['writing','archive','projects']) {
    const base=join(work,'src/content',collection); const extra=collection==='archive'?'historical: true\n':'';
    await writeFile(join(base,'draft-sentinel.md'),fixture('draft-sentinel',`${extra}draft: true\n`));
    await writeFile(join(base,'future-sentinel.md'),fixture('future-sentinel',`${extra}publishedAt: "2999-01-01"\n`));
  }
  await writeFile(join(work,'src/content/writing/automatic-file.md'),fixture('Automatic file route'));
  for(let i=1;i<=6;i++) await writeFile(join(work,`src/content/writing/pagination-fixture-${i}.md`),fixture(`Pagination fixture ${i}`));
  const valid=build(); assert.equal(valid.status,0,valid.stderr+'\n'+valid.stdout);
  assert.ok(await exists(join(work,'dist/writing/automatic-file/index.html')),'Adding Markdown did not create its route.');
  assert.ok(await exists(join(work,'dist/writing/page/2/index.html')),'Pagination did not create page2.');
  assert.ok(await exists(join(work,'dist/writing/category/acceptance-fixture/page/2/index.html')),'Taxonomy pagination did not create page2.');
  for(const file of await textFiles(join(work,'dist'))) { const text=await readFile(file,'utf8'); assert.ok(!/draft-sentinel|future-sentinel/.test(text),`Unpublished content leaked into ${file}`); }
  for(const collection of ['writing','archive','projects']) for(const id of ['draft-sentinel','future-sentinel']) assert.equal(await exists(join(work,'dist',collection==='archive'?'writing/archive':collection,id,'index.html')),false);
  const rss=await readFile(join(work,'dist/rss.xml'),'utf8'); const sitemap=await readFile(join(work,'dist/sitemap.xml'),'utf8'); const search=await readFile(join(work,'dist/search-index.json'),'utf8');
  assert.ok(rss.includes('/writing/automatic-file/')); assert.ok(sitemap.includes('/writing/automatic-file/')); assert.ok(search.includes('/writing/automatic-file/'));
  await writeFile(join(work,'src/content/writing/metadata-error-fixture.md'),'---\ndescription: "Missing required title"\ncategory: Test\nsample: true\n---\n\nInvalid fixture.\n');
  const invalid=build(); assert.notEqual(invalid.status,0,'Invalid frontmatter unexpectedly built.'); assert.match(invalid.stdout+invalid.stderr,/metadata-error-fixture/); assert.match(invalid.stdout+invalid.stderr,/title/i);
  console.log('PASS: file-created route, collection-wide draft/future exclusion, listing/taxonomy pagination, RSS/search/sitemap inclusion, and useful invalid-metadata error.');
} finally { await rm(work,{recursive:true,force:true}); }
