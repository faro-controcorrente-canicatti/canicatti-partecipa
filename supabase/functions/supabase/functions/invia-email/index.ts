import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOGO_URL =
  "https://faro-controcorrente-canicatti.github.io/canicatti-partecipa/logo-canicatti-partecipa.png.PNG";

const MITTENTE =
  "Canicattì Partecipa <info@canicattipartecipa.it>";

const EMAIL_INTERNA =
  "info@canicattipartecipa.it";

/* ============================================
   PROTEZIONE TESTI HTML
   ============================================ */

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

/* ============================================
   MODELLO GRAFICO EMAIL
   ============================================ */

const pagina = (titolo: string, contenuto: string) => `
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

/* ============================================
   FUNZIONE PRINCIPALE
   ============================================ */


const ADMIN_UID = '74b7a543-e730-4b67-9065-a05364f0ea50';
const normalizzaStato = (value: unknown) => String(value || 'Ricevuta').trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
const errorePubblico = (error: string, status=403) => risposta({success:false,error},status);
const fetchLimitato = (url: string, options: RequestInit={}) => fetch(url,{...options,signal:AbortSignal.timeout(15000)});
const chiaveEmail = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest = await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
};

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
      throw new Error("RESEND_API_KEY non configurata");
    }


    const rawBody = await req.text();
    if(new TextEncoder().encode(rawBody).length > 32768)
      return errorePubblico('Richiesta troppo grande',413);
    let body: Record<string,unknown>;
    try {
      body = JSON.parse(rawBody);
      if(!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    } catch { return errorePubblico('Richiesta non valida',400); }
    const emailRichiesta = String(body.email || '').trim().toLowerCase();
    const codice = String(body.numero_pratica || '').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRichiesta) || emailRichiesta.length>254 || !codice || codice.length>80)
      return errorePubblico('Dati della pratica non validi',400);
    const statoRichiesto = normalizzaStato(body.stato);
    const ricevuta = body.tipo_notifica !== 'aggiornamento' && ['ricevuta','in_attesa','in_attesa_di_verifica'].includes(statoRichiesto);
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if(!serviceKey || !supabaseUrl) return errorePubblico('Servizio notifiche non disponibile',503);
    const serviceHeaders = {apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'};
    if(!ricevuta){
      const authorization = req.headers.get('Authorization') || '';
      if(!authorization.startsWith('Bearer ')) return errorePubblico('Accesso amministrativo richiesto',401);
      const authResponse = await fetchLimitato(supabaseUrl+'/auth/v1/user',{headers:{apikey:serviceKey,Authorization:authorization}});
      if(!authResponse.ok) return errorePubblico('Accesso amministrativo richiesto',401);
      const user = await authResponse.json();
      if(user.id !== ADMIN_UID) return errorePubblico('Operazione non autorizzata');
      // L’identità è stata verificata dal servizio Auth sopra.
      // Per gli aggiornamenti amministrativi richiediamo il token AAL2.
      let assurance = null;
      try { assurance = JSON.parse(atob(authorization.slice(7).split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).aal; } catch (_) {}
      if(assurance !== 'aal2') return errorePubblico('Verifica con secondo fattore richiesta',403);
    }
    const praticaId = body.pratica_id == null ? '' : String(body.pratica_id);
    if(praticaId && !/^-?\d{1,19}$/.test(praticaId)) return errorePubblico('Dati della pratica non validi',400);
    const filtro = praticaId ? 'id=eq.'+encodeURIComponent(praticaId) : 'numero_pratica=eq.'+encodeURIComponent(codice);
    const fields = 'id,numero_pratica,email,nome,telefono,categoria,indirizzo,descrizione,stato,data_invio,ente_destinatario';
    const recordResponse = await fetchLimitato(supabaseUrl+'/rest/v1/segnalazioni_cittadini?select='+fields+'&'+filtro+'&limit=2',{headers:serviceHeaders});
    if(!recordResponse.ok) return errorePubblico('Servizio notifiche non disponibile',503);
    const records = await recordResponse.json();
    if(!Array.isArray(records) || records.length!==1) return errorePubblico('Pratica non verificabile');
    const record = records[0];
    if(String(record.email || '').trim().toLowerCase()!==emailRichiesta || String(record.numero_pratica || '').trim()!==codice)
      return errorePubblico('Pratica non verificabile');
    const age = Date.now()-Date.parse(record.data_invio);
    if(ricevuta && (record.stato!=='in_attesa' || !Number.isFinite(age) || age< -60000 || age>3600000))
      return errorePubblico('Conferma iniziale non disponibile');
    if(!ricevuta && statoRichiesto!==record.stato) return errorePubblico('Lo stato della pratica è cambiato',409);
    // Destinatario e testi derivano esclusivamente dalla pratica salvata.
    const emailCittadino = String(record.email).trim();
    const nome = record.nome;
    const telefono = record.telefono;
    const numero_pratica = record.numero_pratica;
    const stato = ricevuta ? 'Ricevuta' : record.stato;
    const oggetto = String(record.categoria || 'Segnalazione')+' – '+String(record.indirizzo || '');
    const messaggio = record.descrizione;
    const corpo = '';
    const ente = record.ente_destinatario;
    const nomeSafe = safe(nome);
    const telefonoSafe = safe(telefono);
    const emailSafe = safe(emailCittadino);
    const numeroPraticaSafe = safe(numero_pratica);
    const oggettoSafe = safe(oggetto);
    const enteSafe = safe(ente);

    const testoSegnalazione =
      safe(messaggio) ||
      safe(corpo) ||
      "Nessun testo disponibile";

    /* ============================================
       STATO
       ============================================ */

    const statoRicevuto =
      String(stato || "Ricevuta").trim();

    const statoNormalizzato =
      statoRicevuto
        .toLowerCase()
        .replaceAll(" ", "_")
        .replaceAll("-", "_");

    let titoloEmail =
      "Aggiornamento della tua segnalazione";

    let testoStato =
      "Ci sono aggiornamenti relativi alla tua segnalazione.";

    let colore = "#1565c0";
    let icona = "📋";
    let nuovaSegnalazione = false;

    /* ============================================
       TESTI AUTOMATICI IN BASE ALLO STATO
       ============================================ */

    switch (statoNormalizzato) {
      case "ricevuta":
      case "in_attesa":
      case "in_attesa_di_verifica":
        nuovaSegnalazione = true;

        titoloEmail =
          "Segnalazione ricevuta";

        testoStato =
          "Abbiamo ricevuto correttamente la tua segnalazione. " +
          "La documentazione sarà verificata prima dell'eventuale " +
          "inoltro all'ente o all'ufficio competente.";

        colore = "#c40000";
        icona = "📥";
        break;

      case "verificata":
      case "documentazione_verificata":
        testoStato =
          "Abbiamo verificato la documentazione relativa alla tua " +
          "segnalazione. La pratica prosegue adesso nel suo percorso.";

        colore = "#0d6efd";
        icona = "🔵";
        break;

      case "inoltrata":
      case "inoltrata_all'ente":
      case "inoltrata_all_ente":
        titoloEmail =
          "La tua segnalazione è stata inoltrata";

        testoStato =
          "La tua segnalazione è stata inoltrata all'ente o " +
          "all'ufficio competente.";

        if (ente) {
          testoStato +=
            " Destinatario: " + enteSafe + ".";
        }

        colore = "#6f42c1";
        icona = "🟣";
        break;

      case "attesa_ente":
      case "in_attesa_dell'ente":
      case "in_attesa_dell_ente":
        testoStato =
          "La segnalazione è stata trasmessa e siamo in attesa " +
          "di un riscontro da parte dell'ente o dell'ufficio competente.";

        colore = "#fd7e14";
        icona = "🟠";
        break;

      case "risolta":
        titoloEmail =
          "Segnalazione risolta";

        testoStato =
          "La tua segnalazione risulta risolta. " +
          "Grazie per aver contribuito attivamente alla cura della nostra città.";

        colore = "#198754";
        icona = "🟢";
        break;

      case "chiusa":
        titoloEmail =
          "Pratica chiusa";

        testoStato =
          "La pratica relativa alla tua segnalazione è stata chiusa.";

        colore = "#495057";
        icona = "⚫";
        break;

      case "rifiutata":
        testoStato =
          "Dopo la verifica, la segnalazione non può proseguire " +
          "nel percorso previsto da Canicattì Partecipa.";

        colore = "#6c757d";
        icona = "⚪";
        break;
    }

    /* ============================================
       NOMI STATI
       ============================================ */

    const nomiStato: Record<string, string> = {
      ricevuta: "Ricevuta",

      in_attesa:
        "In attesa di verifica",

      in_attesa_di_verifica:
        "In attesa di verifica",

      verificata:
        "Documentazione verificata",

      documentazione_verificata:
        "Documentazione verificata",

      inoltrata:
        "Inoltrata all'ente",

      "inoltrata_all'ente":
        "Inoltrata all'ente",

      inoltrata_all_ente:
        "Inoltrata all'ente",

      attesa_ente:
        "In attesa dell'ente",

      "in_attesa_dell'ente":
        "In attesa dell'ente",

      in_attesa_dell_ente:
        "In attesa dell'ente",

      risolta:
        "Risolta",

      chiusa:
        "Chiusa",

      rifiutata:
        "Rifiutata",
    };

    nuovaSegnalazione = ricevuta;
    if(!ricevuta && statoNormalizzato === 'in_attesa'){
      titoloEmail = 'Aggiornamento della tua segnalazione';
      testoStato = 'La tua segnalazione è in attesa di verifica.';
    }

    const statoVisualizzato =
      nomiStato[statoNormalizzato] ||
      statoRicevuto;

    /* ============================================
       EMAIL AL CITTADINO
       ============================================ */

    const htmlCittadino = pagina(
      titoloEmail,
      `
<p>
Ciao <strong>${nomeSafe || "cittadino/a"}</strong>,
</p>

${
  nuovaSegnalazione
    ? `
<p>
abbiamo ricevuto la tua segnalazione.
Grazie per aver scelto di contribuire
alla vita della nostra città.
</p>
`
    : `
<p>
ci sono aggiornamenti relativi alla
segnalazione che hai inviato tramite
<strong>Canicattì Partecipa</strong>.
</p>
`
}

<div style="
background:#f7f7f7;
border-left:5px solid ${colore};
padding:18px;
margin:25px 0;
">

<p style="
font-size:19px;
font-weight:bold;
color:${colore};
margin-top:0;
">
${icona} ${safe(statoVisualizzato)}
</p>

<p style="margin:8px 0;">
<strong>Numero pratica:</strong>
${numeroPraticaSafe || "Non disponibile"}
</p>

${
  oggetto
    ? `
<p style="margin:8px 0;">
<strong>Oggetto:</strong>
${oggettoSafe}
</p>
`
    : ""
}

${
  ente
    ? `
<p style="margin:8px 0;">
<strong>Ente / ufficio:</strong>
${enteSafe}
</p>
`
    : ""
}

<p style="
margin-top:18px;
line-height:1.55;
">
${testoStato}
</p>

${
  nuovaSegnalazione
    ? `
<p style="margin:18px 0 5px;">
<strong>Segnalazione:</strong>
</p>

<p style="
white-space:pre-wrap;
line-height:1.5;
">
${testoSegnalazione}
</p>
`
    : ""
}

</div>

<div style="
background:#fff7e6;
border:1px solid #f0c36d;
padding:18px;
margin:25px 0;
border-radius:6px;
">

<p style="
margin-top:0;
font-weight:bold;
">
IMPORTANTE
</p>

<p style="
margin-bottom:0;
line-height:1.5;
">

Il Faro di Canicattì non è un ufficio reclami
né un servizio di manutenzione.

<strong>
La gestione della segnalazione non comporta
alcun impegno da parte del Faro a risolvere
direttamente il problema segnalato.
</strong>

La nostra iniziativa nasce come forma di
partecipazione e collaborazione civica:
possiamo dare voce alla segnalazione,
individuare gli uffici o gli enti competenti
e, quando possibile, seguirne il percorso
insieme al cittadino.

</p>
</div>

<p>
Puoi conservare il numero pratica
<strong>${numeroPraticaSafe}</strong>
come riferimento per questa segnalazione.
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
Messaggio automatico di Canicattì Partecipa
relativo alla segnalazione
${numeroPraticaSafe}.
</p>
`,
    );

    /* ============================================
       EMAIL INTERNA PER NUOVE SEGNALAZIONI
       ============================================ */

    const htmlInterna = pagina(
      "Nuova segnalazione",
      `
<p>
È arrivata una nuova segnalazione tramite
<strong>Canicattì Partecipa</strong>.
</p>

<div style="
background:#f7f7f7;
border-left:5px solid #d20719;
padding:20px;
margin:25px 0;
">

<p>
<strong>Numero pratica:</strong><br>
${numeroPraticaSafe || "Non disponibile"}
</p>

<p>
<strong>Nome:</strong><br>
${nomeSafe || "Non indicato"}
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

${
  oggetto
    ? `
<p>
<strong>Oggetto:</strong><br>
${oggettoSafe}
</p>
`
    : ""
}

<p>
<strong>Segnalazione:</strong>
</p>

<p style="
white-space:pre-wrap;
line-height:1.5;
">
${testoSegnalazione}
</p>

</div>

<p style="
font-size:13px;
color:#777;
text-align:center;
">
Messaggio automatico generato da
Canicattì Partecipa.
</p>
`,
    );

    /* ============================================
       INVIO EMAIL CON GESTIONE INDIPENDENTE
       DEGLI ERRORI
       ============================================ */


    const eventKey = await chiaveEmail(serviceKey,JSON.stringify(['segnalazione',record.id,ricevuta,numero_pratica,emailCittadino,nome,telefono,stato,oggetto,messaggio,ente]));
    const recipientKey = await chiaveEmail(serviceKey,emailCittadino.toLowerCase());
    const claimResponse = await fetchLimitato(supabaseUrl+'/rest/v1/rpc/cp_claim_email',{
      method:'POST',headers:serviceHeaders,
      body:JSON.stringify({p_event_key:eventKey,p_recipient_key:recipientKey})
    });
    if(!claimResponse.ok) return errorePubblico('Servizio notifiche non disponibile',503);
    const claim = await claimResponse.json();
    if(claim==='limited') return errorePubblico('Limite temporaneo notifiche raggiunto',429);
    if(claim==='expired') return errorePubblico('Notifica già richiesta',409);
    if(claim!=='allowed' && claim!=='retry') return errorePubblico('Servizio notifiche non disponibile',503);

    const invia = async (
      destinatario: string,
      subject: string,
      html: string,
    ) => {
      try {
        const response = await fetchLimitato(
          "https://api.resend.com/emails",
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${RESEND_API_KEY}`,

              "Content-Type":
                "application/json",
              "Idempotency-Key": eventKey + (html === htmlInterna ? ":internal" : ":citizen"),
            },

            body: JSON.stringify({
              from: MITTENTE,

              to: [destinatario],

              reply_to: EMAIL_INTERNA,

              subject,

              html,
            }),
          },
        );

        const testo = await response.text();

        let data: unknown;

        try {
          data = JSON.parse(testo);
        } catch {
          data = {
            message: testo,
          };
        }

        if (!response.ok) {
          return {
            ok: false,
            data,
            error:
              `Fornitore email HTTP ${response.status}`,
          };
        }

        return {
          ok: true,
          data,
          error: null,
        };
      } catch (error) {
        return {
          ok: false,
          data: null,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        };
      }
    };

    /* ============================================
       INVIO AL CITTADINO
       ============================================ */

    const subjectCittadino =
      nuovaSegnalazione
        ? `Segnalazione ricevuta – ${
            numero_pratica ||
            "Canicattì Partecipa"
          }`
        : `Aggiornamento pratica ${
            numero_pratica ||
            "Canicattì Partecipa"
          } – ${statoVisualizzato}`;

    const cittadino = await invia(
      emailCittadino,
      subjectCittadino,
      htmlCittadino,
    );

    if (!cittadino.ok) {
      console.error(
        "Errore invio email cittadino:",
        cittadino.error,
      );
    }

    /* ============================================
       INVIO INTERNO
       VIENE TENTATO ANCHE SE L'EMAIL
       AL CITTADINO NON È PARTITA
       ============================================ */

    let notificaInternaInviata = false;
    let erroreInterna: string | null = null;

    if (nuovaSegnalazione) {
      const subjectInterna =
        `Nuova segnalazione – ${
          numero_pratica ||
          "Canicattì Partecipa"
        }${
          oggetto
            ? ` – ${String(oggetto)}`
            : ""
        }`;

      const interna = await invia(
        EMAIL_INTERNA,
        subjectInterna,
        htmlInterna,
      );

      notificaInternaInviata = interna.ok;
      erroreInterna = interna.error;

      if (!interna.ok) {
        console.error(
          "Errore notifica interna:",
          interna.error,
        );
      }
    }

    /* ============================================
       RISPOSTA FINALE
       I FLAG INDICANO L'ACCETTAZIONE DA RESEND,
       NON LA CONSEGNA NELLA CASELLA
       ============================================ */

    return risposta(
      {
        success: cittadino.ok,

        message:
          cittadino.ok
            ? "Email inviata correttamente"
            : "Invio email al cittadino non riuscito",

        conferma_cittadino:
          cittadino.ok,

        notifica_interna:
          notificaInternaInviata,

        data:
          cittadino.data,

        ...(
          !cittadino.ok
            ? {
                error:
                  "Errore invio email cittadino: " +
                  cittadino.error,
              }
            : {}
        ),

        ...(
          erroreInterna
            ? {
                errore_notifica_interna:
                  erroreInterna,
              }
            : {}
        ),
      },
      cittadino.ok ? 200 : 502,
    );
  } catch (error) {
    console.error("Errore servizio notifiche");

    return risposta(
      {
        success: false,

        error:
          "Servizio notifiche temporaneamente non disponibile",
      },
      500,
    );
  }
});

