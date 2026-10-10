import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ==========================================
   CONFIGURAZIONE
   ========================================== */

const LOGO_URL =
  "https://faro-controcorrente-canicatti.github.io/canicatti-partecipa/logo-canicatti-partecipa.png.PNG";

const MITTENTE =
  "Canicattì Partecipa <info@canicattipartecipa.it>";

const EMAIL_INTERNA =
  "info@canicattipartecipa.it";

/* ==========================================
   PROTEZIONE TESTI HTML
   ========================================== */

const safe = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const risposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

/* ==========================================
   MODELLO GRAFICO EMAIL
   ========================================== */

const pagina = (
  titolo: string,
  contenuto: string,
) => `
<!DOCTYPE html>
<html lang="it">

<head>
<meta charset="UTF-8">
</head>

<body style="
margin:0;
padding:0;
background:#f4f4f4;
font-family:Arial,Helvetica,sans-serif;
color:#222;
">

<div style="
max-width:650px;
margin:0 auto;
background:#ffffff;
padding:30px;
">

<div style="
text-align:center;
margin-bottom:30px;
">

<img
src="${LOGO_URL}"
alt="Canicattì Partecipa - Faro di Canicattì"
width="500"
style="
display:block;
width:500px;
max-width:100%;
height:auto;
margin:0 auto;
border:0;
"
>

</div>

<h2 style="
text-align:center;
color:#c40000;
font-size:28px;
line-height:1.25;
margin:0 0 30px;
">
${safe(titolo)}
</h2>

${contenuto}

</div>
</body>
</html>
`;

/* ==========================================
   FUNZIONE PRINCIPALE
   ========================================== */


/* Limiti condivisi e chiavi idempotenti: nessun dato personale nel registro. */
async function cpBody(req: Request) {
  const reader=req.body?.getReader();
  if(!reader) return {};
  const chunks:Uint8Array[]=[]; let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw new Error('payload');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function cpHash(secret:string,value:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
async function cpReserve(kind:string,email:string,fields:unknown[]){
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
  const url=Deno.env.get('SUPABASE_URL');if(!secret||!url)throw new Error('config');
  const eventKey=await cpHash(secret,JSON.stringify([kind,...fields]));
  const recipientKey=await cpHash(secret,email.toLowerCase());
  const response=await fetch(url+'/rest/v1/rpc/cp_claim_email',{method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({p_event_key:eventKey,p_recipient_key:recipientKey}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('guard');
  const result=await response.json();
  return {eventKey,status:result==='limited'?429:result==='expired'?409:['allowed','retry'].includes(result)?200:503};
}


function cpService(){
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
 const url=Deno.env.get('SUPABASE_URL');if(!secret||!url)throw new Error('config');
 return {url,headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'}};
}
async function cpSavedProposal(body:Record<string,unknown>){
 const {url,headers}=cpService();
 const query=new URLSearchParams({select:'id,created_at,titolo,categoria,descrizione,zona,nome,cognome,email,telefono,allegati,stato_interno',email:'eq.'+String(body.email??'').trim(),titolo:'eq.'+String(body.titolo??'').trim(),created_at:'gte.'+new Date(Date.now()-3600000).toISOString(),stato_interno:'eq.Da valutare',limit:'2'});
 const response=await fetch(url+'/rest/v1/proposte_citta?'+query,{headers,signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('database');
 const rows=await response.json();if(!Array.isArray(rows)||rows.length!==1)return null;
 const row=rows[0];const age=Date.now()-Date.parse(row.created_at);
 if(!Number.isFinite(age)||age< -60000||age>3600000)return null;
 for(const field of ['titolo','categoria','descrizione','zona','nome','cognome','email','telefono']){
   if(String(row[field]??'').trim()!==String(body[field]??'').trim())return null;
 }
 const files=Array.isArray(row.allegati)?row.allegati:[];
 const requested=Array.isArray(body.allegati)?body.allegati:[];
 if(files.length!==requested.length)return null;
 for(let i=0;i<files.length;i++)for(const field of ['nome','percorso','tipo','dimensione'])if(String(files[i]?.[field]??'')!==String(requested[i]?.[field]??''))return null;
 return row;
}
async function cpSaveAdoption(eventKey:string,body:Record<string,unknown>){
 const {url,headers}=cpService();
 const response=await fetch(url+'/rest/v1/cp_adesioni?on_conflict=event_key',{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({event_key:eventKey,nome:String(body.nome??'').trim(),email:String(body.email??'').trim(),telefono:String(body.telefono??'').trim()||null,tipo:String(body.tipo??'').trim(),zona:String(body.zona??'').trim(),messaggio:String(body.messaggio??'').trim()||null}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('database');
}


async function cpMaintenanceAdoption(){
 const {url,headers}=cpService();
 const response=await fetch(url+'/rest/v1/impostazioni_sito?select=manutenzione',{headers,signal:AbortSignal.timeout(15000)});
 if(!response.ok)return false;
 const rows=await response.json();
 return Array.isArray(rows)&&rows.length===1&&rows[0].manutenzione===false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return risposta(
      {
        success: false,
        error: "Metodo non consentito",
      },
      405,
    );
  }

  try {
    const RESEND_API_KEY =
      Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY) {
      throw new Error(
        "RESEND_API_KEY non configurata",
      );
    }

    let body;
    try { body=await cpBody(req); } catch(error) {return risposta({success:false,error:'Richiesta non valida o troppo grande'},error instanceof Error && error.message==='payload'?413:400);}
    if(!body || typeof body!=='object' || Array.isArray(body))return risposta({success:false,error:'Richiesta non valida'},400);

    const nome =
      String(body.nome ?? "").trim();

    const telefono =
      String(body.telefono ?? "").trim();

    const email =
      String(body.email ?? "").trim();

    const tipo =
      String(body.tipo ?? "").trim();

    const zona =
      String(body.zona ?? "").trim();

    const messaggio =
      String(body.messaggio ?? "").trim();

    if (!nome || !email || !tipo || !zona) {
      return risposta(
        {
          success: false,
          error: "Dati obbligatori mancanti",
        },
        400,
      );
    }

    if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return risposta({success:false,error:'Indirizzo email non valido'},400);
    for(const [key,max] of Object.entries({nome:200,email:254,telefono:80,tipo:50,zona:500,messaggio:10000})){
      if(body[key]!=null&&(typeof body[key]!=='string'||String(body[key]).length>max))return risposta({success:false,error:'Controlla i campi della richiesta'},400);
    }
    if(!['Adotta una via','Adotta un quartiere'].includes(tipo))return risposta({success:false,error:'Tipo di adesione non valido'},400);
    if(!(await cpMaintenanceAdoption()))return risposta({success:false,error:'Servizio in manutenzione o temporaneamente non disponibile'},503);
    const reservation=await cpReserve('adozione',email,[nome,email.toLowerCase(),telefono,tipo,zona,messaggio]);
    if(reservation.status!==200)return risposta({success:false,error:reservation.status===429?'Troppi invii: riprova più tardi':'Invio non disponibile, riprova più tardi'},reservation.status);

    await cpSaveAdoption(reservation.eventKey,body);

    const nomeSafe = safe(nome);
    const telefonoSafe = safe(telefono);
    const emailSafe = safe(email);
    const tipoSafe = safe(tipo);
    const zonaSafe = safe(zona);
    const messaggioSafe = safe(messaggio);

    /* ==========================================
       EMAIL INTERNA
       ========================================== */

    const htmlInterna = pagina(
      "Nuova adesione",
      `
<p>
È arrivata una nuova richiesta di partecipazione
al progetto <strong>Adotta una via o un quartiere</strong>.
</p>

<div style="
background:#f7f7f7;
border-left:5px solid #d20719;
padding:20px;
margin:25px 0;
">

<p>
<strong>Nome e cognome:</strong><br>
${nomeSafe}
</p>

<p>
<strong>Telefono:</strong><br>
${telefonoSafe || "Non indicato"}
</p>

<p>
<strong>Email:</strong><br>
<a href="mailto:${emailSafe}">
${emailSafe}
</a>
</p>

<p>
<strong>Tipo di adesione:</strong><br>
${tipoSafe}
</p>

<p>
<strong>Via / Quartiere:</strong><br>
${zonaSafe}
</p>

<p>
<strong>Messaggio:</strong>
</p>

<p style="
white-space:pre-wrap;
line-height:1.5;
">
${messaggioSafe || "Nessun messaggio"}
</p>

</div>

<p style="
font-size:13px;
color:#777;
text-align:center;
">
Messaggio automatico generato da Canicattì Partecipa.
</p>
`,
    );

    /* ==========================================
       EMAIL DI CONFERMA AL CITTADINO
       ========================================== */

    const htmlCittadino = pagina(
      "Adesione ricevuta",
      `
<p>
Ciao <strong>${nomeSafe}</strong>,
</p>

<p>
abbiamo ricevuto la tua disponibilità a partecipare
al progetto <strong>Adotta una via o un quartiere</strong>.
</p>

<div style="
background:#f7f7f7;
border-left:5px solid #ffc800;
padding:20px;
margin:25px 0;
">

<p>
<strong>Tipo:</strong>
${tipoSafe}
</p>

<p>
<strong>Via / Quartiere:</strong>
${zonaSafe}
</p>

</div>

<p>
Grazie per aver scelto di contribuire alla
conoscenza e alla cura della nostra città.
</p>

<p>
La tua disponibilità è stata ricevuta.
Quando necessario, potremo contattarti
utilizzando i recapiti che ci hai indicato.
</p>

<p style="margin-top:30px;">
Grazie per la partecipazione.<br>
<strong>Faro di Canicattì</strong>
</p>

<hr style="
border:none;
border-top:1px solid #ddd;
margin:30px 0 15px;
">

<p style="
font-size:12px;
color:#777;
text-align:center;
">
Messaggio automatico di Canicattì Partecipa.
</p>
`,
    );

    /* ==========================================
       INVIO CON GESTIONE DEGLI ERRORI
       OGNI TENTATIVO È INDIPENDENTE
       ========================================== */

    const invia = async (
      destinatario: string,
      subject: string,
      html: string,
      replyTo: string,
    ) => {
      try {
        const response = await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${RESEND_API_KEY}`,

              "Content-Type":
                "application/json",
              "Idempotency-Key": reservation.eventKey + (html===htmlInterna ? ":internal" : ":citizen"),
            },

            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              from: MITTENTE,
              to: [destinatario],
              reply_to: replyTo,
              subject,
              html,
            }),
          },
        );

        const testo =
          await response.text();

        if (!response.ok) {
          return {
            ok: false,
            error:
              `Servizio email non disponibile (${response.status})`,
          };
        }

        return {
          ok: true,
          error: null,
        };
      } catch (error) {
        return {
          ok: false,
          error:
            "Servizio email non disponibile",
        };
      }
    };

    /* ==========================================
       AVVISO ALLA CASELLA DEL DOMINIO
       ARUBA LO INOLTRA A CONTROCORRENTE
       ========================================== */

    const interna = await invia(
      EMAIL_INTERNA,
      `Nuova adesione – ${tipo} – ${zona}`,
      htmlInterna,
      email,
    );

    if (!interna.ok) {
      console.error(
        "Errore notifica interna adesione:",
        interna.error,
      );
    }

    /* ==========================================
       CONFERMA AL CITTADINO
       IL TENTATIVO AVVIENE ANCHE SE
       L'AVVISO INTERNO NON È PARTITO
       ========================================== */

    const cittadino = await invia(
      email,
      "Abbiamo ricevuto la tua adesione – Canicattì Partecipa",
      htmlCittadino,
      EMAIL_INTERNA,
    );

    if (!cittadino.ok) {
      console.error(
        "Errore conferma cittadino:",
        cittadino.error,
      );
    }

    /* ==========================================
       RISPOSTA FINALE
       SUCCESS RESTA LEGATO ALL'AVVISO INTERNO,
       COME NELLA FUNZIONE PRECEDENTE.

       I FLAG INDICANO L'ACCETTAZIONE DA RESEND,
       NON CERTIFICANO LA CONSEGNA IN CASELLA.
       ========================================== */

    return risposta(
      {
        success: true,
        registrata: true,

        message:
          interna.ok
            ? "Adesione inviata correttamente"
            : "Adesione registrata; avviso interno temporaneamente non disponibile",

        notifica_interna:
          interna.ok,

        conferma_cittadino:
          cittadino.ok,

        ...(
          !interna.ok
            ? {
                error:
                  "Errore invio adesione: " +
                  interna.error,
              }
            : {}
        ),

        ...(
          !cittadino.ok
            ? {
                errore_conferma_cittadino:
                  cittadino.error,
              }
            : {}
        ),
      },
      200,
    );
  } catch (error) {
    console.error("Errore servizio notifiche");

    return risposta(
      {
        success: false,

        error:
          "Servizio notifiche non disponibile",
      },
      500,
    );
  }
});
