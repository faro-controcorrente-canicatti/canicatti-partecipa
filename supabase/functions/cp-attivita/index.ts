import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const OWNER='74b7a543-e730-4b67-9065-a05364f0ea50';
const READER='e6712a60-873b-446b-90ea-5c6811d2b346';
const origins=new Set(['https://canicattipartecipa.it','https://www.canicattipartecipa.it','https://faro-controcorrente-canicatti.github.io']);
const pages=new Set(['/index.html','/partecipa.html','/idee.html','/adozione.html','/stato.html','/iniziative.html','/come-funziona.html','/privacy.html','/cookie.html','/note-legali.html']);
serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(!origins.has(origin))return reply(403,{error:'Origine non consentita'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Metodo non consentito'});
 try{
  if(Number(req.headers.get('content-length')||0)>1024)return reply(413,{error:'Richiesta troppo grande'});
  const raw=await req.text(); if(raw.length>1024)return reply(413,{error:'Richiesta troppo grande'});
  const body=JSON.parse(raw); if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'Richiesta non valida'});
  const url=Deno.env.get('SUPABASE_URL')||'';
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
  if(!url||!key)throw new Error('config');
  const serviceHeaders={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
  async function api(path:string,options:RequestInit={}){
   const r=await fetch(url+path,{...options,headers:{...serviceHeaders,...options.headers},signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw new Error('database');return r.status===204?null:await r.json();
  }
  if(body.azione==='visita'){
   const agent=req.headers.get('user-agent')||'';
   if(!agent||/bot|crawler|spider|headless|preview|facebookexternalhit|slurp/i.test(agent))return reply(200,{ok:true});
   if(!pages.has(body.pagina))return reply(400,{error:'Pagina non valida'});
   const ip=(req.headers.get('x-forwarded-for')||'').split(',')[0].trim();
   if(!ip)return reply(200,{ok:true});
   // Identificatore diverso ogni giorno. Non conserva IP, user agent, cookie o percorsi con query.
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const digest=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode('cp-visite:'+day+':'+ip+':'+agent));
   const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   await api('/rest/v1/rpc/cp_registra_visita',{method:'POST',body:JSON.stringify({p_impronta:hash,p_pagina:body.pagina})});
   return reply(200,{ok:true});
  }
  if(body.azione!=='apertura'||typeof body.id!=='string'||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/.test(body.id))return reply(400,{error:'Richiesta non valida'});
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))return reply(401,{error:'Accesso richiesto'});
  const auth=await fetch(url+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(15000)});
  if(!auth.ok)return reply(401,{error:'Sessione non valida'});
  const user=await auth.json();
  if(user.id===OWNER)return reply(200,{ok:true,esente:true});
  if(user.id!==READER)return reply(403,{error:'Account non autorizzato'});
  // Il destinatario e l’identità derivano dal server, mai dai campi del browser.
  const existing=await api('/rest/v1/cp_aperture_admin?id=eq.'+body.id+'&select=*');
  if(existing.length&&existing[0].utente!==user.id)return reply(403,{error:'Non autorizzato'});
  if(existing[0]?.inviata)return reply(200,{ok:true});
  let event=existing[0];
  if(!event){const rows=await api('/rest/v1/cp_aperture_admin',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({id:body.id,utente:user.id})});event=rows[0];}
  const resend=Deno.env.get('RESEND_API_KEY');if(!resend)throw new Error('email config');
  const date=new Date(event.creata).toLocaleString('it-IT',{timeZone:'Europe/Rome'});
  const mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resend,'Content-Type':'application/json','Idempotency-Key':'cp-apertura-'+body.id},body:JSON.stringify({from:'Canicattì Partecipa <info@canicattipartecipa.it>',to:['sciortinostefano82@gmail.com'],subject:'Accesso al pannello — Controcorrente',text:'È stato aperto il pannello amministratore di canicattipartecipa.it.\nAccount: controcorrentefarocanicatti@gmail.com\nRuolo: sola lettura\nData e ora: '+date+' (Europe/Rome)\n\nL’account è condiviso: questo avviso identifica l’account, non la singola persona che lo utilizza.'}),signal:AbortSignal.timeout(15000)});
  if(!mail.ok)throw new Error('email');
  await api('/rest/v1/cp_aperture_admin?id=eq.'+body.id,{method:'PATCH',body:JSON.stringify({inviata:true})});
  return reply(200,{ok:true});
 }catch(_){return reply(503,{error:'Servizio temporaneamente non disponibile. Riprova.'});}
});
