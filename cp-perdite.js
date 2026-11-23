'use strict';

const cpPerdite = (() => {
  const el = id => document.getElementById(id);
  const centro = [37.358, 13.847];
  const colonne = 'id,luogo,lat,lng,segnalata_il,riparata_il,revisione,foto_tipo';
  const tabella = 'cp_perdite_idriche';
  const impostazioni = 'cp_mappa_perdite';
  const limiteFile = 5 * 1024 * 1024;
  let libreria;

  function nodo(tag, testo) {
    const elemento = document.createElement(tag);
    if (testo !== undefined) elemento.textContent = testo;
    return elemento;
  }

  function dataIt(data) {
    return data.split('-').reverse().join('/');
  }

  function leaflet() {
    if (!libreria) {
      libreria = new Promise((resolve, reject) => {
        const css = nodo('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
        css.crossOrigin = 'anonymous';
        const script = nodo('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve(window.L);
        script.onerror = () => reject(new Error('Cartografia non disponibile.'));
        document.head.append(css, script);
      }).catch(errore => {
        libreria = undefined;
        throw errore;
      });
    }
    return libreria;
  }

  async function creaMappa(id, anteprima = false) {
    const L = await leaflet();
    const mappa = L.map(id, anteprima ? {
      zoomControl: false, dragging: false, keyboard: false, touchZoom: false,
      doubleClickZoom: false, boxZoom: false, scrollWheelZoom: false
    } : { scrollWheelZoom: false }).setView(centro, 14);
    const strade = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19, maxZoom: 21,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mappa);
    if (!anteprima) {
      const fonte = 'https://map.sitr.regione.sicilia.it/gis/rest/services/ortofoto/ortofoto_2022_20cm_sicilia/ImageServer';
      const aerea = L.tileLayer(fonte + '/tile/{z}/{y}/{x}', {
        maxNativeZoom: 20, maxZoom: 21,
        attribution: '<a href="' + fonte + '">Ortofoto AGEA 2022 · Regione Siciliana (SITR)</a>'
      });
      L.control.layers({ 'Strade': strade, 'Foto aerea': aerea }, {}, { collapsed: false }).addTo(mappa);
      aerea.on('tileerror', () => {
        if (mappa.hasLayer(aerea)) {
          mappa.removeLayer(aerea);
          strade.addTo(mappa);
        }
      });
    }
    return mappa;
  }

  function punto(mappa, posizione, titolo, classe, anteprima = false) {
    return window.L.marker(posizione, {
      title: titolo, alt: titolo, keyboard: !anteprima, interactive: !anteprima,
      icon: window.L.divIcon({
        className: 'cp-perdite-punto ' + classe,
        iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10]
      })
    }).addTo(mappa);
  }

  async function richiedi(percorso, opzioni = {}) {
    const { auth, metodo = 'GET', dati } = opzioni;
    const risposta = await fetch(SUPABASE_URL + '/rest/v1/' + percorso, {
      method: metodo,
      headers: {
        apikey: SUPABASE_KEY,
        ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
        ...(dati ? { 'Content-Type': 'application/json', Prefer: 'return=minimal' } : {})
      },
      body: dati ? JSON.stringify(dati) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(45000)
    });
    if (!risposta.ok) throw new Error('Richiesta non riuscita (HTTP ' + risposta.status + ').');
    return risposta.status === 204 || metodo !== 'GET' ? null : risposta.json();
  }

  async function tutte(auth) {
    const risultati = [];
    const passo = 200;
    for (let offset = 0; ; offset += passo) {
      const pagina = await richiedi(tabella + '?select=' + colonne +
        ',ha_pdf&order=segnalata_il.desc,id.asc&limit=' + passo + '&offset=' + offset, { auth });
      risultati.push(...pagina);
      if (pagina.length < passo) return risultati;
    }
  }

  function fileBlob(hex, tipo) {
    const bytes = new Uint8Array((hex.length - 2) / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 + 2 * i, 4 + 2 * i), 16);
    return URL.createObjectURL(new Blob([bytes], { type: tipo }));
  }

  async function allegato(id, colonna, auth) {
    const [riga] = await richiedi(tabella + '?id=eq.' + id + '&select=' + colonna, { auth });
    if (!riga?.[colonna]) throw new Error('Allegato non disponibile.');
    return riga[colonna];
  }

  function linkMaps(query) {
    return 'https://www.google.com/maps/search/?' + new URLSearchParams({ api: '1', query });
  }

  function scheda(riga, auth) {
    const box = nodo('div');
    box.className = 'cp-perdite-popup';
    box.append(nodo('strong', riga.luogo), nodo('p', 'Segnalata il ' + dataIt(riga.segnalata_il)),
      nodo('p', riga.riparata_il ? 'Riparata il ' + dataIt(riga.riparata_il) : 'Da riparare'));
    if (riga.foto_tipo) {
      const foto = nodo('img');
      foto.alt = 'Foto della perdita in ' + riga.luogo;
      box.append(foto);
      allegato(riga.id, 'foto', auth).then(hex => {
        const url = fileBlob(hex, riga.foto_tipo);
        foto.onload = foto.onerror = () => URL.revokeObjectURL(url);
        foto.src = url;
      }).catch(() => foto.replaceWith(nodo('p', 'Foto non disponibile.')));
    }
    if (riga.ha_pdf) {
      const pdf = nodo('button', 'Scarica segnalazione o istanza (PDF)');
      pdf.type = 'button';
      pdf.addEventListener('click', async () => {
        pdf.disabled = true;
        try {
          const url = fileBlob(await allegato(riga.id, 'pdf', auth), 'application/pdf');
          const link = nodo('a');
          link.href = url;
          link.download = 'segnalazione-perdita.pdf';
          box.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch {
          pdf.textContent = 'PDF non disponibile. Riprova';
        } finally {
          pdf.disabled = false;
        }
      });
      box.append(pdf);
    }
    const navigazione = nodo('p');
    const maps = nodo('a', 'Apri il punto in Google Maps');
    maps.href = linkMaps(riga.lat + ',' + riga.lng);
    maps.target = '_blank';
    maps.rel = 'noopener noreferrer';
    navigazione.append(maps);
    box.append(navigazione);
    return box;
  }

  async function home() {
    const sezione = el('cp-perdite-home');
    const anteprima = sezione.hasAttribute('data-anteprima');
    const statoPagina = el('cp-perdite-pagina-stato');
    try {
      const [config] = await richiedi(impostazioni + '?id=eq.1&select=attiva');
      if (!config?.attiva) {
        if (statoPagina) statoPagina.textContent = 'La mappa delle perdite idriche al momento è nascosta.';
        return;
      }
      if (statoPagina) statoPagina.hidden = true;
      sezione.hidden = false;
      const righe = await tutte();
      const riparate = righe.filter(riga => riga.riparata_il).length;
      if (!anteprima) ['totale', 'riparate', 'aperte'].forEach((nome, i) => {
        el('cp-perdite-' + nome).textContent = [righe.length, riparate, righe.length - riparate][i];
      });
      if (!anteprima && !righe.length) el('cp-perdite-stato').textContent = 'Nessuna perdita registrata.';
      const posizioni = new Map();
      for (const riga of righe) {
        const chiave = riga.lat + ',' + riga.lng;
        if (!posizioni.has(chiave)) posizioni.set(chiave, []);
        posizioni.get(chiave).push(riga);
      }
      const mappa = await creaMappa('cp-perdite-mappa', anteprima);
      const coordinate = [];
      for (const gruppo of posizioni.values()) {
        const { lat, lng, luogo } = gruppo[0];
        coordinate.push([lat, lng]);
        const marker = punto(mappa, [lat, lng], gruppo.length > 1 ? luogo + ' (' + gruppo.length + ')' : luogo,
          gruppo.every(riga => riga.riparata_il) ? 'riparata' : '', anteprima);
        if (anteprima) continue;
        marker.bindPopup(() => {
          const contenuto = nodo('div');
          for (const riga of gruppo) contenuto.append(scheda(riga));
          return contenuto;
        }, { maxWidth: 300, maxHeight: 320 });
      }
      if (coordinate.length) mappa.fitBounds(coordinate, { padding: [30, 30], maxZoom: anteprima ? 14 : 16 });
    } catch {
      const stato = sezione.hidden ? statoPagina : el('cp-perdite-stato');
      if (stato) stato.textContent = 'Mappa momentaneamente non disponibile.';
    }
  }

  return { home, creaMappa, punto, richiedi, tutte, scheda, nodo, dataIt, linkMaps, tabella, impostazioni, limiteFile };
})();

if (document.getElementById('cp-perdite-home')) cpPerdite.home();
