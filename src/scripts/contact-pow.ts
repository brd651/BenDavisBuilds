export {};
/// <reference lib="webworker" />
interface Challenge { algorithm: string; challenge: string; salt: string; signature: string; maxNumber: number }
self.addEventListener('message',async(event:MessageEvent<Challenge>)=>{
  const c=event.data;
  if(c.algorithm!=='SHA-256'||!Number.isInteger(c.maxNumber)||c.maxNumber<1||c.maxNumber>250000) {self.postMessage({error:true});return;}
  const encoder=new TextEncoder();const start=performance.now();
  for(let number=0;number<=c.maxNumber;number++){
    if(performance.now()-start>60_000){self.postMessage({error:true});return;}
    const digest=await crypto.subtle.digest('SHA-256',encoder.encode(c.salt+number));
    const hex=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(hex===c.challenge){self.postMessage({payload:btoa(JSON.stringify({algorithm:c.algorithm,challenge:c.challenge,number,salt:c.salt,signature:c.signature}))});return;}
  }
  self.postMessage({error:true});
});
