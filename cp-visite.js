/* Conteggio aggregato senza cookie, identificatori persistenti o dati dei moduli. */
(()=>{
 const url='https://zkwwxxmbikxpzedcmjxx.supabase.co/functions/v1/cp-attivita';
 const key='sb_publishable_5usTyC1lIfP6ykIY456Glw_iJdy6NvP';
 let sent=false;
 function record(){
  if(sent||document.visibilityState!=='visible')return;sent=true;
  let page=location.pathname;
  if(page==='/'||page==='/canicatti-partecipa/')page='/index.html';
  else if(page.startsWith('/canicatti-partecipa/'))page=page.slice('/canicatti-partecipa'.length);
  fetch(url,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({azione:'visita',pagina:page}),keepalive:true}).catch(()=>{});
 }
 if(document.visibilityState==='visible')record();else document.addEventListener('visibilitychange',record);
})();
