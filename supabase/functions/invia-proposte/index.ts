import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MITTENTE =
  "Canicattì Partecipa <info@canicattipartecipa.it>";

const EMAIL_INTERNA =
  "info@canicattipartecipa.it";

const LOGO_URL =
  "https://faro-controcorrente-canicatti.github.io/canicatti-partecipa/logo-canicatti-partecipa.png.PNG";

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
background:#fff;
padding:30px;
">
<div style="
text-align:center;
margin-bottom:30px;
">
<img
src="${LOGO_URL}"
alt="Canicattì Partecipa"
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
">
${safe(titolo)}
</h2>

${contenuto}

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
</div>
</body>
</html>
`;


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
    const apiKey =
      Deno.env.get("RESEND_API_KEY");

    if (!apiKey) {
      throw new Error(
        "RESEND_API_KEY non configurata",
      );
    }

    let body;
    try { body=await cpBody(req); } catch(error) {return risposta({success:false,error:'Richiesta non valida o troppo grande'},error instanceof Error && error.message==='payload'?413:400);}
    if(!body || typeof body!=='object' || Array.isArray(body))return risposta({success:false,error:'Richiesta non valida'},400);

    const nome =
      String(body.nome ?? "").trim();

    const cognome =
      String(body.cognome ?? "").trim();

    const email =
      String(body.email ?? "").trim();

    const telefono =
      String(body.telefono ?? "").trim();

    const titolo =
      String(body.titolo ?? "").trim();

    const categoria =
      String(body.categoria ?? "").trim();

    const descrizione =
      String(body.descrizione ?? "").trim();

    const zona =
      String(body.zona ?? "").trim();

    if (
      !nome ||
      !email ||
      !titolo ||
      !categoria ||
      !descrizione
    ) {
      return risposta(
        {
          success: false,
          error: "Dati obbligatori mancanti",
        },
        400,
      );
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return risposta(
        {
          success: false,
          error: "Indirizzo email non valido",
        },
        400,
      );
    }

    if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return risposta({success:false,error:'Indirizzo email non valido'},400);
    const reservation=await cpReserve('proposta',email,[nome,cognome,email.toLowerCase(),telefono,titolo,categoria,descrizione,zona,body.allegati || []]);
    if(reservation.status!==200)return risposta({success:false,error:reservation.status===429?'Troppi invii: riprova più tardi':'Invio non disponibile, riprova più tardi'},reservation.status);

    const nomeCompleto =
      nome +
      (
        cognome && cognome !== "-"
          ? " " + cognome
          : ""
      );

    const allegati =
      Array.isArray(body.allegati)
        ? body.allegati.slice(0, 6)
        : [];

    const elencoAllegati =
      allegati.length
        ? `
<p>
<strong>Allegati (${allegati.length}):</strong>
</p>
<ul>
${allegati.map(
  (a: unknown) => `
<li>
${safe(
  a &&
  typeof a === "object" &&
  "nome" in a
    ? a.nome
    : "Allegato",
)}
</li>
`,
).join("")}
</ul>
`
        : "<p>Nessun allegato.</p>";

    const riepilogo = `
<div style="
background:#f7f7f7;
border-left:5px solid #ffc800;
padding:20px;
margin:25px 0;
">

<p>
<strong>Titolo:</strong><br>
${safe(titolo)}
</p>

<p>
<strong>Categoria:</strong><br>
${safe(categoria)}
</p>

<p>
<strong>Zona:</strong><br>
${safe(zona) || "Tutta Canicattì"}
</p>

<p>
<strong>La proposta:</strong>
</p>

<p style="
white-space:pre-wrap;
line-height:1.5;
">
${safe(descrizione)}
</p>

${elencoAllegati}

</div>
`;

    const htmlInterna = pagina(
      "Nuova proposta per Canicattì",
      `
<p>
È arrivata una nuova proposta nella raccolta
<strong>“La Canicattì che vorrei”</strong>.
</p>

<p>
<strong>Nome e cognome:</strong><br>
${safe(nomeCompleto)}
</p>

<p>
<strong>Email:</strong><br>
<a href="mailto:${safe(email)}">
${safe(email)}
</a>
</p>

<p>
<strong>Telefono:</strong><br>
${safe(telefono) || "Non indicato"}
</p>

${riepilogo}

<p>
Apri il pannello amministrativo per consultare
la proposta e gli eventuali allegati.
</p>
`,
    );

    const htmlCittadino = pagina(
      "Proposta ricevuta",
      `
<p>
Ciao <strong>${safe(nomeCompleto)}</strong>,
</p>

<p>
abbiamo ricevuto la tua proposta per
<strong>“La Canicattì che vorrei”</strong>.
Grazie per aver condiviso la tua idea
per migliorare la nostra città.
</p>

${riepilogo}

<p>
La proposta sarà conservata nella raccolta
delle idee dei cittadini per essere
successivamente esaminata e approfondita.
Se sarà necessario, potremo contattarti
utilizzando i recapiti che hai indicato.
</p>

<div style="
background:#fff7e6;
border:1px solid #f0c36d;
padding:18px;
border-radius:6px;
">
<strong>
La conferma riguarda la ricezione della proposta:
non comporta la sua approvazione o un impegno
alla sua realizzazione.
</strong>
</div>

<p style="margin-top:30px;">
Grazie per la partecipazione.<br>
<strong>Faro di Canicattì</strong>
</p>
`,
    );

    /*
      Ogni invio gestisce il proprio errore
      senza bloccare l'altro.
    */

    const invia = async (
      to: string,
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
                `Bearer ${apiKey}`,

              "Content-Type":
                "application/json",
              "Idempotency-Key": reservation.eventKey + (html===htmlInterna ? ":internal" : ":citizen"),
            },

            body: JSON.stringify({
              from: MITTENTE,
              to: [to],
              reply_to: replyTo,
              subject,
              html,
            }),

            signal:
              AbortSignal.timeout(15000),
          },
        );

        const testo =
          await response.text();

        return {
          ok: response.ok,

          error:
            response.ok
              ? null
              : `Servizio email non disponibile (${response.status})`,
        };
      } catch (error) {
        return {
          ok: false,

          error:
            "Servizio email non disponibile",
        };
      }
    };

    const interna = await invia(
      EMAIL_INTERNA,
      `Nuova proposta – ${titolo}`,
      htmlInterna,
      email,
    );

    const cittadino = await invia(
      email,
      "Abbiamo ricevuto la tua proposta – La Canicattì che vorrei",
      htmlCittadino,
      EMAIL_INTERNA,
    );

    if (!interna.ok) {
      console.error(
        "Errore notifica proposta:",
        interna.error,
      );
    }

    if (!cittadino.ok) {
      console.error(
        "Errore conferma proposta:",
        cittadino.error,
      );
    }

    /*
      La proposta viene salvata dalla pagina
      prima di chiamare questa funzione.

      Qui riportiamo soltanto l'esito
      dell'accettazione delle email da Resend.
    */

    return risposta({
      success:
        interna.ok && cittadino.ok,

      notifica_interna:
        interna.ok,

      conferma_cittadino:
        cittadino.ok,

      ...(
        !interna.ok
          ? {
              errore_notifica_interna:
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
    });
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
