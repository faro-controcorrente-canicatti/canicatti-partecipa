const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY non configurata");
    }

    const {
      email,
      nome,
      numero_pratica,
      indirizzo,
      categoria,
      stato,
      tipo_email = "ricezione",
      link_stato
    } = await req.json();

    if (!email) {
      throw new Error("Indirizzo email mancante");
    }

    let oggetto = "";
    let titolo = "";
    let messaggio = "";

    if (tipo_email === "ricezione") {
      oggetto = `Segnalazione ricevuta – Pratica n. ${numero_pratica}`;
      titolo = "Abbiamo ricevuto la tua segnalazione";
      messaggio = `
        La tua segnalazione è stata correttamente registrata.
        Il Faro di Canicattì procederà alla verifica della documentazione
        e all'eventuale successivo inoltro all'ente competente.
      `;
    } else {
      oggetto = `Aggiornamento pratica n. ${numero_pratica}`;
      titolo = "La tua pratica è stata aggiornata";
      messaggio = `
        È disponibile un nuovo aggiornamento relativo alla tua segnalazione.
      `;
    }

    const html = `
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
</head>

<body style="margin:0;padding:0;background:#f2f5f7;font-family:Arial,Helvetica,sans-serif;color:#222;">

  <div style="max-width:620px;margin:0 auto;padding:25px 15px;">

    <div style="background:#1769c2;padding:25px;text-align:center;border-radius:16px 16px 0 0;color:white;">
      <div style="font-size:28px;font-weight:700;">
        Canicattì Partecipa
      </div>
      <div style="font-size:16px;margin-top:6px;">
        Faro di Canicattì
      </div>
    </div>

    <div style="background:#ffffff;padding:30px;border-radius:0 0 16px 16px;">

      <h2 style="margin-top:0;color:#1769c2;">
        ${titolo}
      </h2>

      <p>
        Ciao${nome ? " " + nome : ""},
      </p>

      <p style="line-height:1.6;">
        ${messaggio}
      </p>

      <div style="background:#f5f7f9;border-radius:12px;padding:20px;margin:25px 0;">

        <div style="font-size:14px;color:#666;">
          NUMERO PRATICA
        </div>

        <div style="font-size:30px;font-weight:bold;color:#1769c2;margin:4px 0 18px;">
          ${numero_pratica ?? "-"}
        </div>

        ${
          stato
            ? `
          <div style="margin-bottom:14px;">
            <strong>Stato:</strong><br>
            ${stato}
          </div>`
            : ""
        }

        ${
          indirizzo
            ? `
          <div style="margin-bottom:14px;">
            <strong>Indirizzo:</strong><br>
            ${indirizzo}
          </div>`
            : ""
        }

        ${
          categoria
            ? `
          <div>
            <strong>Categoria:</strong><br>
            ${categoria}
          </div>`
            : ""
        }

      </div>

      ${
        link_stato
          ? `
        <div style="text-align:center;margin:30px 0;">
          <a
            href="${link_stato}"
            style="
              display:inline-block;
              background:#1769c2;
              color:white;
              text-decoration:none;
              font-weight:bold;
              padding:15px 25px;
              border-radius:10px;
            "
          >
            Controlla lo stato della pratica
          </a>
        </div>`
          : ""
      }

      <p style="font-size:14px;line-height:1.5;color:#666;margin-top:30px;">
        La piattaforma documenta, verifica e inoltra le segnalazioni.
        Gli eventuali interventi e le relative decisioni restano di
        competenza degli enti responsabili.
      </p>

      <hr style="border:none;border-top:1px solid #ddd;margin:25px 0;">

      <div style="text-align:center;font-size:13px;color:#777;">
        <strong>Canicattì Partecipa</strong><br>
        Un progetto di cittadinanza attiva del Faro di Canicattì
      </div>

    </div>

  </div>

</body>
</html>
`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Canicattì Partecipa <onboarding@resend.dev>",
        to: [email],
        subject: oggetto,
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Errore Resend:", data);
      throw new Error(
        data?.message || "Errore durante l'invio dell'email"
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email inviata correttamente",
        resend: data,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Errore sconosciuto",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
