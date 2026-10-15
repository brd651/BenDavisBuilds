import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createHash} from 'node:crypto';

test.beforeEach(async({page})=>{
 await page.goto('/writing/');
 test.skip(await page.locator('#analytics-preferences').count()===0,'Go services are disabled in this build.');
});

test('analytics are opt-in, pseudonymous and removable without sending form or query content',async({page})=>{
 const batches:any[]=[];
 await page.route('**/api/telemetry',async route=>{batches.push(JSON.parse(route.request().postData()!));await route.fulfill({status:204});});
 await page.goto('/writing/?email=never@example.test&utm_source=newsletter');
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(batches).toEqual([]);
 await page.getByText('Analytics preferences',{exact:true}).click();
 await page.getByRole('button',{name:'Session only',exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await expect.poll(()=>batches.length).toBe(1);
 expect(batches[0].visitor_id).toBeUndefined();expect(batches[0].consent).toBeUndefined();
 expect(batches[0].session_id).toMatch(/^[a-f0-9]{32}$/);
 expect(batches[0].events[0]).toMatchObject({type:'pageview',path:'/writing/',properties:{utm_source:'newsletter'}});
 expect(JSON.stringify(batches)).not.toContain('never@example.test');
 await page.getByRole('button',{name:'Allow returning identifier'}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await expect.poll(()=>batches.length).toBe(2);expect(batches[1].consent).toBe(true);expect(batches[1].visitor_id).toMatch(/^[a-f0-9]{32}$/);
 await page.getByRole('button',{name:'Off',exact:true}).click();
 expect(await page.evaluate(()=>localStorage.getItem('bdb-visitor'))).toBeNull();
 expect(await page.evaluate(()=>sessionStorage.getItem('bdb-session'))).toBeNull();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));expect(batches.length).toBe(2);
});

for(const privacy of ['dnt','gpc','storage-failure']) test(`analytics respect ${privacy} and keep navigation usable`,async({page})=>{
 let calls=0;await page.route('**/api/telemetry',async route=>{calls++;await route.fulfill({status:204})});
 await page.addInitScript(mode=>{
  if(mode==='dnt')Object.defineProperty(navigator,'doNotTrack',{value:'1'});
  if(mode==='gpc')Object.defineProperty(navigator,'globalPrivacyControl',{value:true});
  if(mode==='storage-failure'){Object.defineProperty(window,'localStorage',{get(){throw Error('blocked')}});Object.defineProperty(window,'sessionStorage',{get(){throw Error('blocked')}});}
 },privacy);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/writing/');await page.getByText('Analytics preferences',{exact:true}).click();await page.getByRole('button',{name:'Session only',exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 if(privacy!=='storage-failure')expect(calls).toBe(0);
 await page.locator('.wordmark').click();await expect(page).toHaveURL('/');expect(errors).toEqual([]);
});

for(const theme of ['dark','light']) test(`Contact lazy browser proof and safe delivery states in ${theme}`,async({page})=>{
 await page.addInitScript(t=>localStorage.setItem('built-signal-theme',t),theme);
 let challenges=0;let submitted:any;let workerRequests=0;const batches:any[]=[];
 await page.route('**/api/telemetry',async route=>{batches.push(JSON.parse(route.request().postData()!));await route.fulfill({status:204})});
 page.on('request',request=>{if(request.url().includes('contact-pow'))workerRequests++;});
 const salt='browser-contract?expires=2000000000&';const challenge=createHash('sha256').update(salt+'3').digest('hex');
 await page.route('**/api/contact/challenge',async route=>{challenges++;await route.fulfill({json:{algorithm:'SHA-256',challenge,salt,signature:'fixture',maxnumber:100}})});
 await page.route('**/api/contact',async route=>{submitted=JSON.parse(route.request().postData()!);await route.fulfill({json:{status:'sent'}})});
 await page.goto('/contact/');expect(challenges).toBe(0);expect(workerRequests).toBe(0);
 await page.getByText('Analytics preferences',{exact:true}).click();await page.getByRole('button',{name:'Session only',exact:true}).click();await page.getByLabel('About',{exact:true}).selectOption('mentorship');
 await page.getByLabel('Name',{exact:true}).fill('Browser test');await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');await page.getByLabel('Message',{exact:true}).fill('A temporary browser verification fixture.');
 await page.getByRole('button',{name:'Verify and send'}).click();await expect(page.locator('#contact-status')).toContainText('Your message was sent');
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await expect.poll(()=>batches.flatMap(b=>b.events).filter(e=>e.type==='contact_submitted').length).toBe(1);
 expect(batches.flatMap(b=>b.events).find(e=>e.type==='contact_submitted').properties).toEqual({category:'mentorship'});
 expect(JSON.stringify(batches)).not.toContain('fixture@example.test');expect(JSON.stringify(batches)).not.toContain('temporary browser verification');
 expect(challenges).toBe(1);expect(workerRequests).toBeGreaterThan(0);expect(submitted.submission_id).toMatch(/^[a-f0-9]{32}$/);
 const proof=JSON.parse(Buffer.from(submitted.altcha,'base64').toString());expect(proof.number).toBe(3);expect(createHash('sha256').update(proof.salt+proof.number).digest('hex')).toBe(proof.challenge);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});

test('Contact disabled mail never presents a successful delivery',async({page})=>{
 await page.route('**/api/contact/challenge',async route=>route.fulfill({status:503,json:{error:'delivery_unavailable'}}));
 await page.goto('/contact/');await page.getByLabel('Name',{exact:true}).fill('Fixture');await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');await page.getByLabel('Message',{exact:true}).fill('A temporary delivery failure fixture.');await page.getByRole('button',{name:'Verify and send'}).click();await expect(page.locator('#contact-status')).toContainText('Delivery is unavailable');await expect(page.getByRole('button',{name:'Verify and send'})).toBeEnabled();
});
