export {};
// Consent is required for all collection. Failures never block a navigation or form.
type Choice = 'off' | 'session' | 'returning';
type Props = Record<string, string | number>;
interface Event { id: string; type: string; path: string; properties: Props }
const root = document.querySelector<HTMLElement>('#analytics-preferences');
if (root) {
  const paths = new Set<string>(JSON.parse(document.querySelector('#analytics-paths')?.textContent || '[]'));
  const blocked = () => navigator.doNotTrack === '1' || (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl === true;
  const read = (store: 'local' | 'session', key: string) => { try { return (store==='local'?localStorage:sessionStorage).getItem(key); } catch { return null; } };
  const write = (store: 'local' | 'session', key: string, value?: string) => { try { const target=store==='local'?localStorage:sessionStorage; if (value) target.setItem(key,value); else target.removeItem(key); } catch {} };
  const id = () => { try { return crypto.randomUUID().replaceAll('-',''); } catch { return ''; } };
  let choice: Choice = 'off';
  try { const saved=read('local','bdb-analytics-choice'); if (saved==='session'||saved==='returning') choice=saved; } catch {}
  let session = '';
  let visitor = '';
  let active = false;
  let queue: Event[] = [];
  let lastActivity = Date.now();
  let started = Date.now();
  let elapsed = 0;
  let currentVisible = document.visibilityState === 'visible';
  const milestones = new Set<number>();
  const path = paths.has(location.pathname) ? location.pathname : '/404/';
  const safeCampaign = (value: string | null) => value && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,59}$/.test(value) ? value : undefined;
  function emit(type: string, properties: Props = {}) {
    if (!active || blocked()) return;
    if (Date.now()-lastActivity>30*60_000) { session=id(); write('session','bdb-session',session); }
    lastActivity=Date.now();
    const eventID=id();if(eventID&&queue.length<40) queue.push({id:eventID,type,path,properties});
    if(queue.length>=10) flush();
  }
  function flush() {
    if(!active || blocked() || !queue.length) {queue=[];return;}
    const events=queue.splice(0,20);
    const payload=JSON.stringify({session_id:session,...(choice==='returning'?{visitor_id:visitor,consent:true}:{}),events});
    try {
      // A Blob supplies JSON content type for same-origin sendBeacon requests.
      if(navigator.sendBeacon?.('/api/telemetry',new Blob([payload],{type:'application/json'}))) return;
      void fetch('/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true,credentials:'omit'}).catch(()=>{});
    }catch{}
  }
  function apply(next: Choice, persist = false) {
    choice=next;
    if(persist) write('local','bdb-analytics-choice',choice);
    active=choice!=='off'&&!blocked(); queue=[];
    if(choice!=='returning'||blocked()) {write('local','bdb-visitor');visitor='';}
    if(!active) {write('session','bdb-session');session='';}
    else {
      const prior=read('session','bdb-session');session=prior&&/^[a-f0-9]{32}$/.test(prior)?prior:id();write('session','bdb-session',session);
      if(choice==='returning'){const priorVisitor=read('local','bdb-visitor');visitor=priorVisitor&&/^[a-f0-9]{32}$/.test(priorVisitor)?priorVisitor:id();write('local','bdb-visitor',visitor);}
      const props:Props={};
      try {const ref=new URL(document.referrer);if(ref.origin!==location.origin)props.referrer=ref.origin;}catch{}
      for(const field of ['utm_source','utm_medium','utm_campaign']){const value=safeCampaign(new URLSearchParams(location.search).get(field));if(value)props[field]=value;}
      emit('pageview',props);
    }
    root?.querySelectorAll<HTMLButtonElement>('[data-analytics-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.analyticsChoice===choice)));
    const status=root?.querySelector<HTMLElement>('[data-analytics-status]');
    if(status) status.textContent=blocked()?'Disabled by browser privacy settings.':choice==='off'?'Off. No analytics events are sent.':choice==='session'?'Session analytics allowed. No returning-visitor identifier is stored.':'Analytics and a random returning-visitor identifier are allowed.';
    started=Date.now();elapsed=0;
  }
  root.querySelectorAll<HTMLButtonElement>('[data-analytics-choice]').forEach(button=>button.addEventListener('click',()=>apply(button.dataset.analyticsChoice as Choice,true)));
  window.addEventListener('storage',event=>{if(event.key==='bdb-analytics-choice') apply(event.newValue==='session'||event.newValue==='returning'?event.newValue:'off');});
  // Send only known route keys and fixed interaction labels, never link queries or text.
  document.addEventListener('click',event=>{
    const link=(event.target as Element)?.closest<HTMLAnchorElement>('a[href]');if(!link)return;
    let url:URL;try{url=new URL(link.href)}catch{return;}
    if(url.origin===location.origin&&paths.has(url.pathname)){
      const destination=url.pathname==='/'?'home':url.pathname.replace(/^\/+|\/+$/g,'').replaceAll('/','-').slice(0,60);
      if(link.closest('.site-header, .site-footer'))emit('navigation_click',{destination});
      if(url.pathname==='/contact/')emit('contact_intent',{category:'general'});
      if(url.pathname==='/mentorship/')emit('mentorship_intent',{action:'open'});
      if(url.pathname.startsWith('/projects/')||url.pathname==='/lab/')emit('project_interaction',{project:destination,action:'open'});
    } else {
      const social:Record<string,string>={'www.linkedin.com':'linkedin','github.com':'github','x.com':'x'};
      if(social[url.hostname])emit('social_click',{destination:social[url.hostname]});
      // Intent only. No click is reported as a confirmed booking.
      const provider:Record<string,string>={'calendly.com':'calendly','calendar.google.com':'google-calendar'};
      if(provider[url.hostname])emit('booking_intent',{provider:provider[url.hostname]});
    }
  });
  document.addEventListener('bdb:contact-sent',event=>{
    const category=(event as CustomEvent<{category?:unknown}>).detail?.category;
    if(typeof category==='string'&&['general','leadership','project','mentorship'].includes(category))emit('contact_submitted',{category});
  });
  window.addEventListener('scroll',()=>{
    if(!active)return;const range=document.documentElement.scrollHeight-innerHeight;
    if(range<=0)return;const percent=scrollY/range*100;
    for(const milestone of [25,50,75,90,100])if(percent>=milestone&&!milestones.has(milestone)){milestones.add(milestone);emit('scroll',{milestone});}
  },{passive:true});
  function engagement(){if(currentVisible)elapsed+=Date.now()-started;started=Date.now();currentVisible=document.visibilityState==='visible';if(elapsed>=1000){emit('engagement',{kind:document.querySelector('.article-body,.article-prose,article')?'article':'page',seconds:Math.min(1800,Math.floor(elapsed/1000))});elapsed=0;}}
  document.addEventListener('visibilitychange',()=>{engagement();if(document.visibilityState==='hidden')flush();});
  window.addEventListener('pagehide',()=>{engagement();flush();});
  setInterval(flush,10_000);
  try { apply(choice); } catch { active=false; }
}
