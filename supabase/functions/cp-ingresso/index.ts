import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const MAX_FILE = 10 * 1024 * 1024;
const encoder = new TextEncoder();
const origins = new Set(["https://canicattipartecipa.it", "https://www.canicattipartecipa.it", "https://faro-controcorrente-canicatti.github.io"]);
type Ticket = { id: string; flusso: string; email_hash: string; exp: number };
class IntakeError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

function config() {
 let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
 if (!key) { try { key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; } catch { /* fail closed */ } }
 const url = Deno.env.get("SUPABASE_URL") || "";
 if (!url || !key) throw new IntakeError(503, "Servizio temporaneamente non disponibile.");
 return { url, key };
}
function cors(req: Request) {
 const origin = req.headers.get("origin") || "";
 return {
  ...(origins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cp-ticket, x-cp-name, x-cp-kind",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Cache-Control": "no-store",
 };
}
function reply(req: Request, status: number, data: unknown) {
 return new Response(JSON.stringify(data), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}
async function limitedBody(req: Request, max: number): Promise<Uint8Array> {
 const length = req.headers.get("content-length");
 if (length && (!/^\d+$/.test(length) || Number(length) > max)) throw new IntakeError(413, "Il file o la richiesta supera la dimensione consentita.");
 if (!req.body) throw new IntakeError(400, "Richiesta vuota.");
 const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
 try {
  while (true) { const { value, done } = await reader.read(); if (done) break;
   total += value.byteLength; if (total > max) { await reader.cancel(); throw new IntakeError(413, "Il file o la richiesta supera la dimensione consentita."); } chunks.push(value);
  }
 } finally { reader.releaseLock(); }
 const out = new Uint8Array(total); let offset = 0; for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
 return out;
}
async function jsonBody(req: Request) {
 let data; try { data = JSON.parse(new TextDecoder().decode(await limitedBody(req, 32768))); }
 catch (e) { if (e instanceof IntakeError) throw e; throw new IntakeError(400, "Richiesta non valida."); }
 if (!data || typeof data !== "object" || Array.isArray(data)) throw new IntakeError(400, "Richiesta non valida.");
 return data as Record<string, unknown>;
}
async function requestService(path: string, options: RequestInit = {}) {
 const { url, key } = config(); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
 try {
  const response = await fetch(url + path, { ...options, headers: { apikey: key, Authorization: "Bearer " + key, ...options.headers }, signal: controller.signal });
  const text = await response.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* do not return provider body */ }
  if (!response.ok) {
   const msg = String(data?.message || "");
   if (msg.includes("CP_LIMIT")) throw new IntakeError(429, "Sono state inviate troppe richieste. Attendi e riprova più tardi.");
   if (msg.includes("CP_TICKET")) throw new IntakeError(409, "La sessione di invio è scaduta. Ricarica la pagina e riprova.");
   if (msg.includes("CP_FILE")) throw new IntakeError(409, "Gli allegati non corrispondono a questa richiesta. Riprova l’invio.");
   if (msg.includes("CP_INPUT")) throw new IntakeError(400, "Dati non validi.");
   console.error("cp-ingresso: servizio", response.status, /^[A-Z0-9_]+$/.test(data?.code || "") ? data.code : "errore");
   throw new IntakeError(503, "Servizio temporaneamente non disponibile. Riprova più tardi.");
  }
  return data;
 } finally { clearTimeout(timeout); }
}
function rpc(name: string, data: unknown) {
 return requestService("/rest/v1/rpc/" + name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
async function maintenance() {
 const settings = await requestService("/rest/v1/impostazioni_sito?select=manutenzione");
 if (!Array.isArray(settings) || settings.length !== 1) throw new IntakeError(503, "Servizio temporaneamente non disponibile.");
 if (settings[0].manutenzione === true) throw new IntakeError(503, "Il sito è in manutenzione. Riprova più tardi.");
}
async function hmacKey() { return crypto.subtle.importKey("raw", encoder.encode(config().key), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
function base64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function decode64(text: string) {
 if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new IntakeError(403, "Autorizzazione di invio non valida.");
 try { return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)); }
 catch { throw new IntakeError(403, "Autorizzazione di invio non valida."); }
}
async function hashEmail(email: string) {
 const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode("cp-ingresso-email:" + email.toLowerCase())));
 return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
async function signTicket(ticket: Ticket) {
 const payload = base64url(encoder.encode(JSON.stringify(ticket)));
 const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode("cp-ingresso-ticket:" + payload)));
 return payload + "." + base64url(sig);
}
async function checkTicket(value: string): Promise<Ticket> {
 if (!value || value.length > 1024) throw new IntakeError(403, "Autorizzazione di invio non valida.");
 const parts = value.split(".");
 if (parts.length !== 2 || !(await crypto.subtle.verify("HMAC", await hmacKey(), decode64(parts[1]), encoder.encode("cp-ingresso-ticket:" + parts[0])))) throw new IntakeError(403, "Autorizzazione di invio non valida.");
 let t; try { t = JSON.parse(new TextDecoder().decode(decode64(parts[0]))); } catch { throw new IntakeError(403, "Autorizzazione di invio non valida."); }
 if (!t || !/^[a-f0-9-]{36}$/.test(t.id) || !["segnalazione", "proposta"].includes(t.flusso) || !/^[a-f0-9]{64}$/.test(t.email_hash) || !Number.isFinite(t.exp) || t.exp <= Date.now() || t.exp > Date.now() + 3605000) throw new IntakeError(403, "Autorizzazione di invio scaduta o non valida.");
 return t;
}
function field(data: Record<string, unknown>, name: string, max: number, required = false): string {
 if (data[name] == null && !required) return "";
 if (typeof data[name] !== "string") throw new IntakeError(400, "Controlla il campo " + name + ".");
 const value = (data[name] as string).trim();
 if (value.length > max || (required && !value) || value.includes("\0")) throw new IntakeError(400, "Controlla il campo " + name + ".");
 return value;
}
function emailField(data: Record<string, unknown>) {
 const email = field(data, "email", 254, true);
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IntakeError(400, "Inserisci un indirizzo email valido.");
 return email;
}
function validatedData(flow: string, input: Record<string, unknown>) {
 const email = emailField(input), nome = field(input, "nome", 200, true), telefono = field(input, "telefono", 80), descrizione = field(input, "descrizione", 10000, true);
 const categoria = field(input, "categoria", 100, true);
 const common = { nome, email, telefono: telefono || null, descrizione, categoria };
 if (flow === "segnalazione") {
  if (!["strade", "acqua", "rifiuti", "illuminazione", "verde", "segnaletica", "degrado", "altro"].includes(categoria)) throw new IntakeError(400, "Scegli una categoria valida.");
  if (!Array.isArray(input.foto_urls) || input.foto_urls.length > 5 || input.foto_urls.some(x => typeof x !== "string" || x.length > 300)) throw new IntakeError(400, "Fotografie non valide.");
  return { ...common, indirizzo: field(input, "indirizzo", 500, true), foto_urls: input.foto_urls };
 }
 if (!["Sport e impianti", "Giovani", "Mobilità e viabilità", "Ambiente e verde", "Cultura ed eventi", "Centro storico e quartieri", "Servizi", "Sociale", "Commercio e sviluppo economico", "Altro"].includes(categoria)) throw new IntakeError(400, "Scegli una categoria valida.");
 if (!Array.isArray(input.allegati) || input.allegati.length > 6) throw new IntakeError(400, "Allegati non validi.");
 const allegati = input.allegati.map((a: any) => {
  if (!a || typeof a !== "object" || Array.isArray(a) || !Number.isInteger(a.dimensione) || a.dimensione < 1 || a.dimensione > MAX_FILE) throw new IntakeError(400, "Allegati non validi.");
  return { nome: field(a, "nome", 255, true), percorso: field(a, "percorso", 300, true), tipo: field(a, "tipo", 100, true), dimensione: a.dimensione };
 });
 return { ...common, titolo: field(input, "titolo", 300, true), zona: field(input, "zona", 500), cognome: field(input, "cognome", 200, true), allegati };
}
function fileFormat(bytes: Uint8Array, name: string, kind: string) {
 const match = (...sig: number[]) => sig.every((v, i) => bytes[i] === v);
 const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
 let mime = "", ext = "";
 if (match(137,80,78,71,13,10,26,10)) [mime,ext]=["image/png","png"];
 else if (match(255,216,255)) [mime,ext]=["image/jpeg","jpg"];
 else if (ascii(0,4)==="RIFF" && ascii(8,12)==="WEBP") [mime,ext]=["image/webp","webp"];
 else if (["GIF87a","GIF89a"].includes(ascii(0,6))) [mime,ext]=["image/gif","gif"];
 else if (ascii(0,2)==="BM") [mime,ext]=["image/bmp","bmp"];
 else if (match(73,73,42,0) || match(77,77,0,42)) [mime,ext]=["image/tiff","tiff"];
 else if (ascii(4,8)==="ftyp" && ["heic","heix","hevc","hevx","mif1"].includes(ascii(8,12))) [mime,ext]=["image/heic","heic"];
 else if (ascii(4,8)==="ftyp" && ["avif","avis"].includes(ascii(8,12))) [mime,ext]=["image/avif","avif"];
 if (kind === "foto" && mime) return { mime, ext };
 if (kind === "documento" && /\.pdf$/i.test(name) && ascii(0,5)==="%PDF-") return { mime: "application/pdf", ext: "pdf" };
 if (kind === "documento" && /\.doc$/i.test(name) && match(208,207,17,224,161,177,26,225)) return { mime: "application/msword", ext: "doc" };
 if (kind === "documento" && /\.docx$/i.test(name) && match(80,75,3,4)) {
  // ZIP Word: richiede i marcatori OOXML; non è una scansione antivirus.
  const text = new TextDecoder("latin1").decode(bytes);
  if (text.includes("[Content_Types].xml") && text.includes("word/")) return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
 }
 throw new IntakeError(415, kind === "foto" ? "Formato immagine non supportato. Usa JPG, PNG, WebP, GIF, BMP, TIFF, HEIC o AVIF." : "Il documento deve essere un PDF o un file Word valido.");
}

serve(async (req: Request) => {
 try {
  const origin = req.headers.get("origin");
  if (origin && !origins.has(origin)) return reply(req, 403, { error: "Origine non consentita." });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "Metodo non consentito." });
  const action = new URL(req.url).searchParams.get("azione");
  if (!["prepara", "carica", "salva"].includes(action || "")) throw new IntakeError(400, "Richiesta non valida.");
  await maintenance();
  if (action === "prepara") {
   const data = await jsonBody(req), email = emailField(data), flow = field(data, "flusso", 30, true);
   if (data.sito_web || !["segnalazione", "proposta"].includes(flow)) throw new IntakeError(400, "Richiesta non valida.");
   const email_hash = await hashEmail(email), id = await rpc("cp_prepara_ingresso", { p_email_hash: email_hash, p_flusso: flow });
   if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new IntakeError(503, "Servizio temporaneamente non disponibile.");
   return reply(req, 200, { ticket: await signTicket({ id, flusso: flow, email_hash, exp: Date.now() + 3600000 }) });
  }
  const ticket = await checkTicket(req.headers.get("x-cp-ticket") || "");
  if (action === "carica") {
   let name; try { name = decodeURIComponent(req.headers.get("x-cp-name") || "").trim(); } catch { throw new IntakeError(400, "Nome file non valido."); }
   if (!name || name.length > 255 || /[\x00-\x1f]/.test(name)) throw new IntakeError(400, "Nome file non valido.");
   const kind = req.headers.get("x-cp-kind") || "";
   if (!["foto", "documento"].includes(kind) || (ticket.flusso === "segnalazione" && kind !== "foto")) throw new IntakeError(400, "Allegato non valido.");
   const bytes = await limitedBody(req, MAX_FILE); if (!bytes.length) throw new IntakeError(400, "Il file è vuoto.");
   const { mime, ext } = fileFormat(bytes, name, kind);
   const file = await rpc("cp_prenota_file", { p_ticket: ticket.id, p_genere: kind, p_nome: name, p_mime: mime, p_dimensione: bytes.length, p_estensione: ext });
   if (!file?.id || !["segnalazioni-foto", "allegati-proposte"].includes(file.bucket) || typeof file.percorso !== "string" || !file.percorso.includes(ticket.id)) throw new IntakeError(503, "Servizio temporaneamente non disponibile.");
   await requestService("/storage/v1/object/" + file.bucket + "/" + file.percorso.split("/").map(encodeURIComponent).join("/"), { method: "POST", headers: { "Content-Type": mime, "x-upsert": "false" }, body: bytes });
   const saved = await requestService("/rest/v1/cp_ingresso_files?id=eq." + encodeURIComponent(file.id) + "&pronto=eq.false", { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ pronto: true }) });
   if (!Array.isArray(saved) || saved.length !== 1) throw new IntakeError(503, "Caricamento non confermato. Riprova più tardi.");
   return reply(req, 200, { nome: name, percorso: file.percorso, tipo: mime, dimensione: bytes.length });
  }
  const input = await jsonBody(req), data = validatedData(ticket.flusso, input);
  if (await hashEmail(data.email) !== ticket.email_hash) throw new IntakeError(403, "L’email non corrisponde alla sessione di invio.");
  const result = await rpc("cp_completa_ingresso", { p_ticket: ticket.id, p_dati: data });
  if (!result?.id || (ticket.flusso === "segnalazione" && !/^CP-\d{6}-[A-Z0-9]{12}$/.test(result.numero_pratica))) throw new IntakeError(503, "Registrazione non confermata. Riprova più tardi.");
  return reply(req, 200, result);
 } catch (e) {
  if (e instanceof IntakeError) return reply(req, e.status, { error: e.message });
  console.error("cp-ingresso: errore interno");
  return reply(req, 503, { error: "Servizio temporaneamente non disponibile. Riprova più tardi." });
 }
});
