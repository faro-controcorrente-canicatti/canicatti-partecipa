import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const answer=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
const request=(url:string,options:RequestInit={})=>fetch(url,{...options,signal:AbortSignal.timeout(15000)});
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function bounded(response:Response|Request,max:number){
 const reader=response.body?.getReader();if(!reader)return '';
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('too_large');}parts.push(value);}
 const buffer=new Uint8Array(size);let pos=0;for(const p of parts){buffer.set(p,pos);pos+=p.length;}return new TextDecoder().decode(buffer);
}
async function signature(req:Request,raw:string,secret:string){
 try{
  const id=req.headers.get('svix-id'),time=req.headers.get('svix-timestamp'),sigs=req.headers.get('svix-signature')||'';
  if(!id||!time||!/^\d+$/.test(time)||Math.abs(Date.now()/1000-Number(time))>300||!secret.startsWith('whsec_'))return false;
  const key=await crypto.subtle.importKey('raw',bytes(secret.slice(6)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  for(const s of sigs.split(' ')){const [version,value]=s.split(',');if(version==='v1'&&value&&await crypto.subtle.verify('HMAC',key,bytes(value),new TextEncoder().encode(id+'.'+time+'.'+raw)))return true;}
 }catch(_){}return false;
}
async function route(secret:string,id:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('cp-risposta:'+id))),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);}
function plain(html:string){return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\s*br\s*\/?\s*>|<\/p>|<\/div>|<\/li>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&#(\d+);/g,(_,n)=>{const cp=Number(n);return cp<=0x10ffff?String.fromCodePoint(cp):'';}).replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').trim();}
const emailAddress=(s:unknown)=>{const value=String(s||'').trim();return (value.match(/<([^<>]+)>/)?.[1]||value).toLowerCase();};
serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return answer({error:'Metodo non consentito'},405);
 try{
  const base=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
  const resendKey=Deno.env.get('RESEND_RECEIVE_API_KEY')||Deno.env.get('RESEND_API_KEY');
  const domain=(Deno.env.get('CP_REPLY_DOMAIN')||'').toLowerCase(),secret=Deno.env.get('CP_REPLY_WEBHOOK_SECRET')||'';
  if(!base||!service)return answer({error:'Servizio non disponibile'},503);
  const headers={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
  const raw=await bounded(req,65536);
  if(req.headers.has('svix-id')){
   if(!await signature(req,raw,secret))return answer({error:'Firma non valida'},401);
   const event=JSON.parse(raw);if(event.type!=='email.received')return answer({ignored:true});
   const id=String(event.data?.email_id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return answer({error:'Evento non valido'},400);
   if(!resendKey||!domain)return answer({error:'Ricezione non configurata'},503);
   const received=await request('https://api.resend.com/emails/receiving/'+id+'?html_format=cid',{headers:{Authorization:'Bearer '+resendKey}});
   if(!received.ok)return answer({error:'Lettura email temporaneamente non disponibile'},503);
   const mail=JSON.parse(await bounded(received,2097152));
   const targets=Array.isArray(mail.to)?mail.to:[];
   let praticaId='';
   for(const target of targets){
    const address=emailAddress(target),at=address.lastIndexOf('@');if(address.slice(at+1)!==domain)continue;
    const m=address.slice(0,at).match(/^cp-(\d{1,19})-([0-9a-f]{32})$/);if(!m)continue;
    if(m[2]!==await route(service,m[1]))continue;
    if(praticaId&&praticaId!==m[1])return answer({ignored:true});praticaId=m[1];
   }
   if(!praticaId)return answer({ignored:true});
   const record=await request(base+'/rest/v1/segnalazioni_cittadini?select=id,email&id=eq.'+praticaId,{headers});if(!record.ok)throw Error();
   const rows=await record.json();if(rows.length!==1)return answer({ignored:true});
   const from=emailAddress(mail.from),known=from===emailAddress(rows[0].email);
   const auth=mail.authentication;
   const verifica=!known?'Indirizzo del mittente diverso da quello registrato nella pratica.':auth?.dmarc==='fail'?'Il controllo DMARC del mittente non è riuscito.':(!auth||auth.dmarc!=='pass')?'Identità del mittente non certificata dal servizio email.':null;
   const text=String(mail.text||plain(String(mail.html||''))).slice(0,200000);
   const message={pratica_id:praticaId,event_key:'ricevuta:'+id,direzione:'entrata',origine:'email',stato:'ricevuto',mittente:String(mail.from||'').slice(0,400),destinatario:targets.map(emailAddress).join(', ').slice(0,500),oggetto:String(mail.subject||'Senza oggetto').slice(0,1000),testo:text||'(Messaggio senza testo: consulta l’email originale.)',provider_id:id,verifica,documenti:(Array.isArray(mail.attachments)?mail.attachments:[]).slice(0,100).map((a:any)=>({nome:String(a.filename||'Allegato'),tipo:String(a.content_type||''),ricevuto:true})),data_messaggio:Number.isFinite(Date.parse(mail.created_at))?mail.created_at:new Date().toISOString()};
   const saved=await request(base+'/rest/v1/cp_messaggi_pratica?on_conflict=event_key',{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify(message)});
   if(!saved.ok)throw Error();return answer({success:true});
  }
  const authorization=req.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer '))return answer({error:'Accesso richiesto'},401);
  const userResponse=await request(base+'/auth/v1/user',{headers:{apikey:service,Authorization:authorization}});if(!userResponse.ok)return answer({error:'Accesso richiesto'},401);
  const user=await userResponse.json();let aal='';try{aal=JSON.parse(atob(authorization.slice(7).split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).aal;}catch(_){}
  if(!(user.id==='74b7a543-e730-4b67-9065-a05364f0ea50'&&aal==='aal2')&&user.id!=='e6712a60-873b-446b-90ea-5c6811d2b346')return answer({error:'Non autorizzato'},403);
  const body=JSON.parse(raw);
  if(body.azione==='stato')return answer({ricezione_attiva:!!domain&&!!secret&&!!resendKey});
  if(body.azione!=='originale'||!/^[-0-9a-f]{36}$/i.test(body.messaggio_id||''))return answer({error:'Richiesta non valida'},400);
  const result=await request(base+'/rest/v1/cp_messaggi_pratica?select=provider_id,origine,direzione&id=eq.'+body.messaggio_id,{headers});if(!result.ok)throw Error();const rows=await result.json();
  if(rows.length!==1||rows[0].origine!=='email'||rows[0].direzione!=='entrata')return answer({error:'Messaggio non trovato'},404);
  const received=await request('https://api.resend.com/emails/receiving/'+encodeURIComponent(rows[0].provider_id)+'?html_format=cid',{headers:{Authorization:'Bearer '+resendKey}});if(!received.ok)throw Error();
  const mail=JSON.parse(await bounded(received,2097152)),url=new URL(mail.raw?.download_url||'');
  if(url.protocol!=='https:'||!url.hostname.endsWith('.cloudfront.net'))return answer({error:'Email originale non disponibile'},503);
  return answer({url:url.href});
 }catch(_){return answer({error:'Servizio messaggi temporaneamente non disponibile. Riprova.'},503);}
});
