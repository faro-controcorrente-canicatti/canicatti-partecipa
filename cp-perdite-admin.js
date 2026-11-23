'use strict';

const cpPerditeAdmin = (() => {
  const el = nome => document.getElementById('cp-perdite-' + nome);
  const { richiedi, tutte, creaMappa, punto, nodo, scheda, tabella, impostazioni, limiteFile } = cpPerdite;
  const editor = el('editor');
  const modulo = el('modulo');
  let mappa, mappaInAttesa, marker, selezionata, occupato = false, generazione = 0;

  function messaggio(testo, errore = false) {
    el('admin-stato').textContent = testo;
    el('admin-stato').style.color = errore ? '#b42318' : '';
  }

  function letturaAutorizzata() {
    return token && cpIsOwner() && cpTokenLevel(token) === 'aal2';
  }

  async function azione(lavoro) {
    if (occupato || !letturaAutorizzata()) return;
    const corrente = generazione;
    occupato = true;
    el('comandi').disabled = true;
    el('campi').disabled = true;
    el('admin-elenco').inert = true;
    messaggio('Caricamento…');
    try {
      await lavoro(corrente);
    } catch (errore) {
      if (corrente === generazione) messaggio(errore.message, true);
    } finally {
      if (corrente === generazione) {
        occupato = false;
        el('comandi').disabled = false;
        el('campi').disabled = false;
        el('admin-elenco').inert = false;
      }
    }
  }

  async function aggiorna(corrente, testo) {
    const [[config], righe] = await Promise.all([
      richiedi(impostazioni + '?id=eq.1&select=attiva', { auth: token }),
      tutte(token)
    ]);
    if (corrente !== generazione) return;
    if (!config) throw new Error('Impostazioni della mappa non disponibili.');
    el('attiva').checked = config.attiva;
    el('visibilita').textContent = config.attiva ? 'Visibile nella home' : 'Nascosta nella home';
    el('salva-visibilita').disabled = false;
    el('nuova').disabled = false;
    const elenco = el('admin-elenco');
    elenco.replaceChildren();
    if (!righe.length) elenco.append(nodo('p', 'Nessuna perdita registrata.'));
    for (const riga of righe) {
      const card = nodo('article');
      card.className = 'card';
      const dettagli = nodo('details');
      dettagli.append(nodo('summary', 'Date e allegati'));
      dettagli.addEventListener('toggle', () => {
        if (dettagli.open && dettagli.childElementCount === 1) dettagli.append(scheda(riga, token));
      });
      const modifica = nodo('button', 'Modifica perdita');
      modifica.type = 'button';
      modifica.addEventListener('click', () => apriEditor(riga));
      card.append(nodo('h3', riga.luogo), nodo('p', riga.riparata_il ? 'Riparata' : 'Da riparare'), dettagli, modifica);
      elenco.append(card);
    }
    messaggio(testo);
  }

  function disegnaPunto(centra = false) {
    if (!mappa) return;
    if (marker) { marker.remove(); marker = null; }
    const lat = el('lat').valueAsNumber, lng = el('lng').valueAsNumber;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    marker = punto(mappa, [lat, lng], 'Punto selezionato', 'scelta');
    if (centra) mappa.setView([lat, lng], 16);
  }

  async function apriEditor(riga) {
    if (!letturaAutorizzata() || occupato) return;
    modulo.reset();
    selezionata = riga;
    el('titolo-editor').textContent = riga ? 'Modifica perdita' : 'Nuova perdita';
    el('luogo').value = riga?.luogo ?? '';
    el('lat').value = riga?.lat ?? '';
    el('lng').value = riga?.lng ?? '';
    el('segnalata').value = riga?.segnalata_il ?? '';
    el('riparata').value = riga?.riparata_il ?? '';
    el('riparata').min = el('segnalata').value;
    el('rimuovi-foto').hidden = !riga?.foto_tipo;
    el('rimuovi-pdf').hidden = !riga?.ha_pdf;
    el('mappa-errore').textContent = '';
    editor.hidden = false;
    el('luogo').focus();
    const corrente = generazione;
    try {
      mappaInAttesa ??= creaMappa('cp-perdite-scelta').then(creata => {
        mappa = creata;
        mappa.on('click', evento => {
          el('lat').value = evento.latlng.lat.toFixed(6);
          el('lng').value = evento.latlng.lng.toFixed(6);
          disegnaPunto();
        });
      }).catch(errore => { mappaInAttesa = undefined; throw errore; });
      await mappaInAttesa;
      if (corrente === generazione && !editor.hidden) {
        mappa.invalidateSize();
        disegnaPunto(true);
      }
    } catch {
      if (corrente === generazione) el('mappa-errore').textContent = 'Cartografia non disponibile. Puoi inserire le coordinate qui sotto.';
    }
  }

  async function leggiFile(file, tipi) {
    if (!tipi.includes(file.type) || !file.size || file.size > limiteFile) {
      throw new Error('Formato non supportato o allegato superiore a 5 MB.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valori = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
    let hex = '';
    for (let i = 0; i < bytes.length; i += 8192) hex += Array.from(bytes.subarray(i, i + 8192), b => valori[b]).join('');
    const valida = {
      'application/pdf': hex.startsWith('255044462d'),
      'image/jpeg': hex.startsWith('ffd8ff'),
      'image/png': hex.startsWith('89504e470d0a1a0a'),
      'image/webp': hex.startsWith('52494646') && hex.slice(16, 24) === '57454250'
    };
    if (!valida[file.type]) throw new Error('Il contenuto dell’allegato non corrisponde al formato scelto.');
    return '\\x' + hex;
  }

  modulo.addEventListener('submit', evento => {
    evento.preventDefault();
    azione(async corrente => {
      const riga = selezionata;
      const foto = el('foto').files[0], pdf = el('pdf').files[0];
      const dati = {
        luogo: el('luogo').value.trim(),
        lat: el('lat').valueAsNumber, lng: el('lng').valueAsNumber,
        segnalata_il: el('segnalata').value, riparata_il: el('riparata').value || null
      };
      if (!dati.luogo) throw new Error('Inserisci la via o il luogo.');
      if (el('togli-foto').checked) Object.assign(dati, { foto: null, foto_tipo: null });
      if (el('togli-pdf').checked) dati.pdf = null;
      if (foto) Object.assign(dati, { foto: await leggiFile(foto, ['image/jpeg', 'image/png', 'image/webp']), foto_tipo: foto.type });
      if (pdf) dati.pdf = await leggiFile(pdf, ['application/pdf']);
      if (corrente !== generazione || !letturaAutorizzata()) return;
      let query = '?select=id';
      if (riga) {
        dati.revisione = riga.revisione + 1;
        query += '&id=eq.' + riga.id + '&revisione=eq.' + riga.revisione;
      }
      await cpRichiesta(tabella, query, riga ? 'PATCH' : 'POST', dati);
      if (corrente !== generazione) return;
      editor.hidden = true;
      modulo.reset();
      await aggiorna(corrente, 'Perdita salvata.');
    });
  });

  el('visibilita-form').addEventListener('submit', evento => {
    evento.preventDefault();
    azione(async corrente => {
      const attiva = el('attiva').checked;
      await cpRichiesta(impostazioni, '?id=eq.1&select=id,attiva', 'PATCH', { attiva });
      if (corrente !== generazione) return;
      el('visibilita').textContent = attiva ? 'Visibile nella home' : 'Nascosta nella home';
      messaggio(attiva ? 'Mappa pubblica attivata.' : 'Mappa pubblica disattivata.');
    });
  });
  el('aggiorna').addEventListener('click', apri);
  el('nuova').addEventListener('click', () => apriEditor());
  el('annulla').addEventListener('click', () => { editor.hidden = true; });
  el('rimuovi-data').addEventListener('click', () => { el('riparata').value = ''; });
  el('segnalata').addEventListener('change', () => { el('riparata').min = el('segnalata').value; });
  for (const nome of ['lat', 'lng']) el(nome).addEventListener('change', () => disegnaPunto(true));

  function apri() {
    if (!letturaAutorizzata()) {
      messaggio('Per gestire la mappa accedi con il secondo fattore.', true);
      return;
    }
    azione(corrente => aggiorna(corrente, ''));
  }

  function reset() {
    generazione++;
    occupato = false;
    selezionata = undefined;
    editor.hidden = true;
    modulo.reset();
    if (marker) { marker.remove(); marker = null; }
    el('attiva').checked = false;
    el('visibilita').textContent = '';
    el('salva-visibilita').disabled = true;
    el('nuova').disabled = true;
    el('comandi').disabled = false;
    el('admin-elenco').replaceChildren();
    messaggio('');
  }

  return { apri, reset };
})();
