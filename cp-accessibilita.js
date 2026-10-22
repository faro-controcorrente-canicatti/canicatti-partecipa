/* Preferenze locali di lettura per le sole pagine pubbliche. */
(() => {
 'use strict';
 if(/\/(admin|recupera-password)\.html$/.test(location.pathname))return;
 const key='cp-accessibilita-v1';
 const defaults={size:1,contrast:false,links:false,motion:false};
 let prefs={...defaults};
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved){prefs.size=[1,1.15,1.3].includes(saved.size)?saved.size:1;for(const k of ['contrast','links','motion'])prefs[k]=saved[k]===true;}}catch(_){}
 const style=document.createElement('style');
 style.textContent=`
 body{padding-bottom:80px!important}
 #cpAccessibilita{font:16px/1.5 Arial,sans-serif;color:#15333b;position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:100000;text-align:left;max-width:calc(100vw - 32px)}
 #cpAccessibilita *{box-sizing:border-box;letter-spacing:normal;text-shadow:none}
 #cpAccessibilita button,#cpAccessibilita select{font:inherit;min-height:44px;border:2px solid #174f5c;border-radius:10px;padding:8px 12px;color:#15333b;background:#fff;cursor:pointer;margin:0;width:auto}
 #cpAccessibilita #cpAperturaAccessibilita{background:#174f5c;color:#fff;box-shadow:0 3px 12px #0003;font-weight:700}
 #cpAccessibilita button:hover{background:#e9f2f3}
 #cpAccessibilita [hidden]{display:none!important}
 #cpAccessibilitaPanel{width:330px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 100px);overflow:auto;padding:18px;margin-bottom:10px;background:white;border:2px solid #174f5c;border-radius:14px;box-shadow:0 8px 30px #0003}
 #cpAccessibilita h2{font:700 20px/1.3 Arial,sans-serif;margin:0 0 12px;color:#15333b}
 #cpAccessibilita p{font:14px/1.5 Arial,sans-serif;margin:8px 0 14px;color:#3e555d}
 #cpAccessibilita label{display:flex;align-items:center;gap:12px;min-height:48px;margin:8px 0;font:16px/1.4 Arial,sans-serif;color:#15333b}
 #cpAccessibilita label[for=cpDimensioneTesto]{display:block}
 #cpAccessibilita select{width:100%;margin-bottom:8px}
 #cpAccessibilita input[type=checkbox]{appearance:auto;width:22px;height:22px;flex:0 0 22px;margin:0;accent-color:#174f5c}
 #cpAccessibilita .cp-a11y-actions{display:flex;justify-content:space-between;gap:8px;margin-top:16px}
 :focus-visible{outline:3px solid #005fcc!important;outline-offset:4px!important}
 html.cp-a11y-size [data-cp-a11y-text]{font-size:calc(var(--cp-a11y-base) * var(--cp-a11y-scale))!important}
 html.cp-a11y-links a:not(#cpAccessibilita a){text-decoration:underline!important;text-decoration-thickness:2px!important;text-underline-offset:3px!important}
 html.cp-a11y-contrast body,html.cp-a11y-contrast body *:not(img):not(video):not(svg):not(svg *){background-color:#fff!important;background-image:none!important;color:#111!important;text-shadow:none!important;box-shadow:none!important}
 html.cp-a11y-contrast a{color:#003e99!important;text-decoration:underline!important}
 html.cp-a11y-contrast button,html.cp-a11y-contrast input,html.cp-a11y-contrast textarea,html.cp-a11y-contrast select{border:2px solid #111!important}
 html.cp-a11y-contrast ::placeholder{color:#444!important;opacity:1!important}
 html.cp-a11y-motion *,html.cp-a11y-motion *::before,html.cp-a11y-motion *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
 @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
 @media print{#cpAccessibilita{display:none!important}}
 `;
 document.head.append(style);
 const root=document.createElement('div');root.id='cpAccessibilita';
 root.innerHTML=`<section id="cpAccessibilitaPanel" aria-labelledby="cpAccessibilitaTitolo" hidden><h2 id="cpAccessibilitaTitolo">Accessibilità</h2><p>Personalizza la lettura. Le preferenze valgono su questo dispositivo.</p><label for="cpDimensioneTesto">Dimensione del testo</label><select id="cpDimensioneTesto"><option value="1">Normale (100%)</option><option value="1.15">Grande (115%)</option><option value="1.3">Molto grande (130%)</option></select><label><input id="cpAltoContrasto" type="checkbox">Contrasto elevato</label><label><input id="cpLinkEvidenti" type="checkbox">Evidenzia i collegamenti</label><label><input id="cpRiduciMovimento" type="checkbox">Riduci le animazioni</label><div class="cp-a11y-actions"><button id="cpResetAccessibilita" type="button">Ripristina</button><button id="cpChiudiAccessibilita" type="button">Chiudi</button></div><p id="cpAccessibilitaStato" role="status" aria-live="polite"></p></section><button id="cpAperturaAccessibilita" type="button" aria-expanded="false" aria-controls="cpAccessibilitaPanel">Accessibilità</button>`;
 document.body.append(root);
 const get=id=>document.getElementById(id),html=document.documentElement;
 const panel=get('cpAccessibilitaPanel'),opener=get('cpAperturaAccessibilita');
 const size=get('cpDimensioneTesto');
 function measure(){
  html.classList.remove('cp-a11y-size');
  const targets=[...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,li,label,input,textarea,select,button,span,strong,small,summary,td,th,legend,figcaption,blockquote,dt,dd')].filter(el=>!root.contains(el));
  const sizes=targets.map(el=>getComputedStyle(el).fontSize);
  targets.forEach((el,index)=>{el.style.setProperty('--cp-a11y-base',sizes[index]);el.setAttribute('data-cp-a11y-text','');});
  html.style.setProperty('--cp-a11y-scale',prefs.size);
  html.classList.toggle('cp-a11y-size',prefs.size!==1);
 }
 function apply(save=false){
  size.value=String(prefs.size);
  for(const [field,option,cls] of [['cpAltoContrasto','contrast','cp-a11y-contrast'],['cpLinkEvidenti','links','cp-a11y-links'],['cpRiduciMovimento','motion','cp-a11y-motion']]){get(field).checked=prefs[option];html.classList.toggle(cls,prefs[option]);}
  measure();
  if(save){try{localStorage.setItem(key,JSON.stringify(prefs));get('cpAccessibilitaStato').textContent='Preferenze salvate.';}catch(_){get('cpAccessibilitaStato').textContent='Preferenze applicate per questa pagina.';}}
 }
 function close(){panel.hidden=true;opener.setAttribute('aria-expanded','false');opener.focus();}
 opener.addEventListener('click',()=>{if(!panel.hidden){close();return;}panel.hidden=false;opener.setAttribute('aria-expanded','true');size.focus();});
 get('cpChiudiAccessibilita').addEventListener('click',close);
 root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();close();}});
 size.addEventListener('change',()=>{prefs.size=Number(size.value);apply(true);});
 for(const [id,k] of [['cpAltoContrasto','contrast'],['cpLinkEvidenti','links'],['cpRiduciMovimento','motion']])get(id).addEventListener('change',()=>{prefs[k]=get(id).checked;apply(true);});
 get('cpResetAccessibilita').addEventListener('click',()=>{prefs={...defaults};apply(true);get('cpAccessibilitaStato').textContent='Impostazioni iniziali ripristinate.';});
 let timer;const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(prefs.size!==1)measure();},150);};
 new MutationObserver(records=>{if(records.some(r=>!root.contains(r.target)))refresh();}).observe(document.body,{childList:true,subtree:true});
 window.addEventListener('resize',refresh);apply();
})();
