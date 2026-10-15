export {};
const form=document.querySelector<HTMLFormElement>('#contact-form');
if(form){
 const status=document.querySelector<HTMLElement>('#contact-status')!;
 const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;
 let worker:Worker|undefined;
 let busy=false;
 let submissionID=crypto.randomUUID().replaceAll('-','');
 form.hidden=false;
 status.textContent='Mail delivery is checked when you send. Your message is not saved by this page.';
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  busy=true;button.disabled=true;form.setAttribute('aria-busy','true');status.textContent='Checking delivery and verifying your browser...';
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90_000);
  try{
   const response=await fetch('/api/contact/challenge',{cache:'no-store',credentials:'omit',signal:controller.signal});
   if(!response.ok)throw Error('Delivery is unavailable. Please try again later.');
   const challenge:unknown=await response.json();
   const altcha=await new Promise<string>((resolve,reject)=>{
    worker=new Worker(new URL('./contact-pow.ts',import.meta.url),{type:'module'});
    controller.signal.addEventListener('abort',()=>{worker?.terminate();reject(Error('Verification timed out. Please try again.'));},{once:true});
    worker.onmessage=(message:MessageEvent<{payload?:string;error?:boolean}>)=>{worker?.terminate();if(message.data.payload)resolve(message.data.payload);else reject(Error('Verification could not finish. Please try again.'));};
    worker.onerror=()=>{worker?.terminate();reject(Error('Verification could not finish. Please try again.'));};worker.postMessage(challenge);
   });
   status.textContent='Sending your message...';
   const fields=new FormData(form);
   const sent=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',signal:controller.signal,body:JSON.stringify({name:fields.get('name'),email:fields.get('email'),category:fields.get('category'),message:fields.get('message'),website:fields.get('website'),altcha,submission_id:submissionID})});
   if(!sent.ok)throw Error(sent.status===429?'Too many attempts. Please wait before trying again.':'Your message was not confirmed. Please try again later.');
   const result=await sent.json() as {status?:string};
   if(result.status!=='sent')throw Error('Your message was not confirmed. Please try again later.');
   form.reset();submissionID=crypto.randomUUID().replaceAll('-','');status.textContent='Your message was sent. Thank you.';
   document.dispatchEvent(new CustomEvent('bdb:contact-sent'));
  }catch(error){status.textContent=error instanceof Error?error.message:'Delivery is unavailable. Please try again later.';}
  finally{clearTimeout(timer);worker?.terminate();busy=false;button.disabled=false;form.removeAttribute('aria-busy');}
 });
}
