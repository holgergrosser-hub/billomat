/**
 * Netlify Function: Forderungsakte (für Inkasso / Mahnbescheid) auf Knopfdruck.
 *
 * GET /.netlify/functions/billomat-akte?rechnungsnummer=RE21
 *     Header x-admin-token oder ?token=   (Admin-, Lese- oder Mahn-Token)
 *     &intern=1   zusätzlich interne Hinweise (Telefonblatt) – nur Admin
 *     &pdf=<rechnung_id>   liefert stattdessen das Original-Rechnungs-PDF aus Billomat
 *
 * Inhalt: Gläubiger, Schuldner (Anschrift live aus Billomat), alle Rechnungen des Kunden
 * (offen und erledigt, soweit in der Datenbank), Rechnungspositionen (live aus Billomat),
 * Zahlungen, kompletter Mahn- und Kontaktverlauf, Gesprächsnotizen, Zusagen, Anlagen.
 * Druckbare HTML-Seite – im Browser „Drucken → Als PDF speichern“.
 */

'use strict';

const { authorize } = require('../../billomat/auth');
const { billomatGetJson } = require('../../billomat/billomat-api');
const sb = require('../../billomat/supabase-rest');

const GLAEUBIGER = {
  firma: 'QM-Dienstleistungen Grosser',
  inhaber: 'Holger Grosser',
  strasse: 'Simonstr. 14',
  ort: '90763 Fürth',
  telefon: '+49 911 49522541',
  email: 'holger.grosser@iso9001.info',
  mahnpostfach: 'Mahnungen@iso9001.info'
};

const STUFEN = { 0: 'Nachfrage / Kontakt', 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung – letzte Zahlungsaufforderung', 4: 'Letzte Frist / Forderungsschreiben' };
const KANAL = { gmail: 'E-Mail', telefon: 'Telefon', whatsapp: 'WhatsApp', brief: 'Brief' };
const KATEGORIE = { A: 'wartet auf BAFA-Zuschuss', B: 'inhaltlicher Einwand', C: 'Rechnung hat den Kunden nicht erreicht', D: 'keine Reaktion', E: 'Lage ungeklärt', F: 'Zahlungsaufschub zugesagt' };

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function de(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}
function euro(n) {
  return Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function money(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function toArray(container, key) {
  if (!container) return [];
  const inner = container[key];
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === 'object') return [inner];
  return [];
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysBetween(fromIso, toIso) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fromIso || ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(toIso || ''));
  if (!a || !b) return null;
  return Math.floor((Date.UTC(b[1], b[2] - 1, b[3]) - Date.UTC(a[1], a[2] - 1, a[3])) / 86400000);
}

function response(statusCode, body, headers) {
  return { statusCode, headers: { 'cache-control': 'no-store', ...headers }, body };
}
const json = (code, obj) => response(code, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8' });

async function safe(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}

async function fetchClient(id) {
  if (!id) return null;
  return safe(async () => (await billomatGetJson({ path: `/api/clients/${id}` })).client || null, null);
}
async function fetchItems(invoiceId) {
  return safe(async () => toArray((await billomatGetJson({ path: '/api/invoice-items', query: { invoice_id: invoiceId, per_page: 100 } }))['invoice-items'], 'invoice-item'), []);
}
async function fetchInvoice(invoiceId) {
  return safe(async () => (await billomatGetJson({ path: `/api/invoices/${invoiceId}` })).invoice || null, null);
}
async function fetchPdf(invoiceId) {
  const data = await billomatGetJson({ path: `/api/invoices/${invoiceId}/pdf` });
  return data && data.pdf ? data.pdf : null;
}

function renderHtml({ haupt, rechnungen, kunde, items, zahlungen, mahnungen, notizen, intern, token, base }) {
  const offen = rechnungen.filter((r) => !r.erledigt);
  const summeOffen = offen.reduce((s, r) => s + money(r.offen), 0);
  const summeBrutto = rechnungen.reduce((s, r) => s + money(r.brutto), 0);
  const summeBezahlt = rechnungen.reduce((s, r) => s + money(r.bezahlt), 0);
  const heute = todayIso();

  // Chronologie: Rechnungen, Zahlungen, Mahnungen, Notizen in einer Zeitleiste
  const ereignisse = [];
  for (const r of rechnungen) {
    ereignisse.push({ datum: r.datum, art: 'Rechnung', text: `Rechnung ${r.rechnungsnummer} über ${euro(r.brutto)}, fällig ${de(r.faellig)}`, re: r.rechnungsnummer });
  }
  for (const z of zahlungen) {
    ereignisse.push({ datum: z.datum, art: 'Zahlung', text: `Zahlungseingang ${euro(z.betrag)} auf ${z.rechnungsnummer}${z.typ ? ' (' + z.typ + ')' : ''}${z.kommentar ? ' – ' + z.kommentar : ''}`, re: z.rechnungsnummer });
  }
  for (const m of mahnungen) {
    const datum = m.status === 'gesendet' ? m.gesendet_am : String(m.erstellt || '').slice(0, 10);
    const status = m.status === 'gesendet' ? '' : ` [${m.status}]`;
    ereignisse.push({ datum, art: `${STUFEN[m.stufe] || 'Stufe ' + m.stufe}${status}`, text: `${KANAL[m.kanal] || m.kanal}${m.empfaenger ? ' an ' + m.empfaenger : ''}${m.betreff ? ' · „' + m.betreff + '“' : ''}${m.kommentar ? ' – ' + m.kommentar : ''}`, re: m.rechnungsnummer, link: m.gmail_thread ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(GLAEUBIGER.email)}#all/thread-f:${m.gmail_thread}` : null });
  }
  for (const n of notizen) {
    ereignisse.push({ datum: String(n.erstellt || '').slice(0, 10), art: `Gesprächsnotiz (${n.autor})`, text: n.text, re: n.rechnungsnummer });
  }
  ereignisse.sort((a, b) => String(a.datum || '').localeCompare(String(b.datum || '')));

  const zusagen = notizen.filter((n) => /zugesagt|überwiesen|überweis|zahl[et]? bis|kommt bis|in \d+ Tagen/i.test(n.text));
  const einwaende = notizen.filter((n) => /bestreit|einwand|nicht einverstanden|zu hoch|reklam/i.test(n.text));

  const adresse = kunde ? [kunde.name, kunde.street, [kunde.zip, kunde.city].filter(Boolean).join(' '), kunde.country_code && kunde.country_code !== 'DE' ? kunde.country_code : ''].filter(Boolean) : [haupt.kunde];
  const ansprech = kunde ? [kunde.salutation, kunde.first_name, kunde.last_name].filter(Boolean).join(' ') : [haupt.anrede, haupt.vorname, haupt.nachname].filter(Boolean).join(' ');
  const kontakte = [
    kunde?.email || haupt.email ? `E-Mail: ${kunde?.email || haupt.email}` : '',
    kunde?.phone || haupt.telefon ? `Telefon: ${kunde?.phone || haupt.telefon}` : '',
    kunde?.mobile || haupt.mobil ? `Mobil: ${kunde?.mobile || haupt.mobil}` : '',
    kunde?.tax_number ? `Steuernummer: ${kunde.tax_number}` : '',
    kunde?.vat_identifier ? `USt-IdNr.: ${kunde.vat_identifier}` : '',
    kunde?.client_number || haupt.kundennummer ? `Kundennummer: ${kunde?.client_number || haupt.kundennummer}` : ''
  ].filter(Boolean);

  // PDF-Links ohne Token in der URL (sonst landet der Token im gedruckten PDF); Abruf per Script mit Header.
  const pdfLink = (r) => `#pdf-${r.id}`;
  const pdfAttr = (r) => `href="${pdfLink(r)}" onclick="return oeffnePdf(${Number(r.id)}, '${esc(r.rechnungsnummer)}')"`;

  const css = `
  body{font:11.5pt/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0;background:#fff}
  .seite{max-width:800px;margin:0 auto;padding:28px 32px}
  h1{font-size:19pt;margin:0 0 4px} h2{font-size:13pt;margin:22px 0 8px;border-bottom:1px solid #999;padding-bottom:3px}
  .kopf{display:flex;justify-content:space-between;gap:24px;margin-top:14px} .box{flex:1;border:1px solid #bbb;border-radius:6px;padding:10px 12px;font-size:10.5pt}
  .box b{display:block;font-size:9pt;letter-spacing:1.2px;color:#555;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;font-size:10.5pt;margin:6px 0} th,td{border:1px solid #bbb;padding:5px 7px;vertical-align:top;text-align:left} th{background:#eee}
  td.r,th.r{text-align:right;white-space:nowrap} .sum td{font-weight:700;background:#f5f5f5}
  .hinweis{background:#fff8e1;border:1px solid #e0c060;border-radius:6px;padding:8px 12px;font-size:10.5pt}
  .intern{background:#f3f3f3;border:1px dashed #999;border-radius:6px;padding:8px 12px;font-size:10pt;color:#333}
  .klein{font-size:9.5pt;color:#555} .tools{position:fixed;top:10px;right:10px;display:flex;gap:8px}
  .tools button,.tools a{font:10.5pt Arial;padding:7px 12px;border:1px solid #333;border-radius:6px;background:#fff;color:#111;text-decoration:none;cursor:pointer}
  .nowrap{white-space:nowrap} .fuss{margin-top:28px;font-size:8.5pt;color:#777;text-align:center}
  @media print{.tools{display:none} .seite{padding:0} h2{page-break-after:avoid} tr{page-break-inside:avoid}}
  `;

  const rechnungsTabelle = rechnungen.map((r) => `<tr>
    <td class="nowrap">${esc(r.rechnungsnummer)}${r.rechnungsnummer === haupt.rechnungsnummer ? ' <span class="klein">(Hauptforderung)</span>' : ''}</td>
    <td class="nowrap">${de(r.datum)}</td><td class="nowrap">${de(r.faellig)}</td>
    <td class="r">${euro(r.brutto)}</td><td class="r">${euro(r.bezahlt)}</td><td class="r">${euro(r.erledigt ? 0 : r.offen)}</td>
    <td>${r.erledigt ? `${esc(r.status)}${r.bezahlt_am ? ' am ' + de(r.bezahlt_am) : ''}` : `offen, ${daysBetween(r.faellig, heute)} Tage überfällig`}</td>
    <td><a ${pdfAttr(r)}>PDF</a></td>
  </tr>`).join('');

  const positionen = Object.entries(items).map(([re, list]) => list.length ? `
    <div class="klein" style="margin-top:6px"><b>${esc(re)}</b></div>
    <table><tr><th>Pos.</th><th>Leistung</th><th class="r">Menge</th><th class="r">Einzelpreis netto</th><th class="r">Gesamt brutto</th></tr>
    ${list.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.title || '')}${it.description ? '<div class="klein">' + esc(String(it.description).replace(/\s+/g, ' ').slice(0, 400)) + '</div>' : ''}</td><td class="r">${esc(it.quantity || '')} ${esc(it.unit || '')}</td><td class="r">${euro(it.unit_price)}</td><td class="r">${euro(it.total_gross)}</td></tr>`).join('')}
    </table>` : '').join('') || '<p class="klein">Keine Positionen abrufbar.</p>';

  const zahlungsTabelle = zahlungen.length
    ? `<table><tr><th>Datum</th><th>Rechnung</th><th class="r">Betrag</th><th>Art</th><th>Vermerk</th></tr>${zahlungen.map((z) => `<tr><td class="nowrap">${de(z.datum)}</td><td>${esc(z.rechnungsnummer)}</td><td class="r">${euro(z.betrag)}</td><td>${esc(z.typ || '')}</td><td>${esc(z.kommentar || '')}</td></tr>`).join('')}</table>`
    : '<p>Kein Zahlungseingang verzeichnet.</p>';

  const verlauf = `<table><tr><th class="nowrap">Datum</th><th>Vorgang</th><th>Inhalt</th><th>Rechnung</th></tr>
    ${ereignisse.map((e) => `<tr><td class="nowrap">${de(e.datum) || '–'}</td><td>${esc(e.art)}</td><td>${esc(e.text)}${e.link ? ` <a class="klein" href="${esc(e.link)}" target="_blank">[Mail]</a>` : ''}</td><td class="nowrap">${esc(e.re || '')}</td></tr>`).join('')}
  </table>`;

  const liste = (arr) => arr.length ? `<ul>${arr.map((n) => `<li><span class="klein">${de(String(n.erstellt).slice(0, 10))} (${esc(n.autor)}):</span> ${esc(n.text)}</li>`).join('')}</ul>` : '<p class="klein">keine</p>';

  const mahnsperre = offen.map((r) => r.mahnsperre ? `${r.rechnungsnummer}: ${r.mahnsperre}${r.mahnsperre_bis ? ' (bis ' + de(r.mahnsperre_bis) + ')' : ''}` : '').filter(Boolean);
  const stand = offen.map((r) => {
    const g = mahnungen.filter((m) => m.rechnungsnummer === r.rechnungsnummer && m.status === 'gesendet' && m.stufe >= 1);
    const hoechste = g.reduce((a, m) => (m.stufe > (a?.stufe ?? -1) ? m : a), null);
    return `<tr><td>${esc(r.rechnungsnummer)}</td><td>${hoechste ? `${STUFEN[hoechste.stufe]} am ${de(hoechste.gesendet_am)}` : 'keine Mahnung gesendet'}</td><td>${g.length} Mahnschreiben, ${mahnungen.filter((m) => m.rechnungsnummer === r.rechnungsnummer && m.stufe === 0).length} Kontakte</td><td>${r.kategorie ? esc(r.kategorie + ' – ' + (KATEGORIE[r.kategorie] || '')) : '–'}</td></tr>`;
  }).join('');

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="${esc(base)}"><title>Forderungsakte ${esc(haupt.kunde)} – ${esc(haupt.rechnungsnummer)}</title><style>${css}</style></head><body>
<div class="tools"><button onclick="window.print()">🖨 Drucken / als PDF speichern</button><a href="/?view=forderungen">← zurück</a></div>
<div class="seite">
<h1>Forderungsakte ${esc(haupt.kunde)}</h1>
<div class="klein">Erstellt am ${de(heute)} · Hauptforderung ${esc(haupt.rechnungsnummer)} · Stand der Datenbank (Spiegel von Billomat) und der Gesprächsnotizen</div>
<div class="kopf">
  <div class="box"><b>GLÄUBIGER</b>${esc(GLAEUBIGER.firma)}<br>${esc(GLAEUBIGER.inhaber)}<br>${esc(GLAEUBIGER.strasse)}<br>${esc(GLAEUBIGER.ort)}<br>${esc(GLAEUBIGER.telefon)} · ${esc(GLAEUBIGER.email)}</div>
  <div class="box"><b>SCHULDNER</b>${adresse.map(esc).join('<br>')}${ansprech ? `<br>Ansprechpartner: ${esc(ansprech)}` : ''}<br>${kontakte.map(esc).join('<br>')}</div>
</div>

<h2>1. Forderungsaufstellung</h2>
<table><tr><th>Rechnung</th><th>Datum</th><th>Fällig</th><th class="r">Brutto</th><th class="r">Bezahlt</th><th class="r">Offen</th><th>Status</th><th>Beleg</th></tr>
${rechnungsTabelle}
<tr class="sum"><td colspan="3">Summe (${rechnungen.length} Rechnung${rechnungen.length === 1 ? '' : 'en'}, davon ${offen.length} offen)</td><td class="r">${euro(summeBrutto)}</td><td class="r">${euro(summeBezahlt)}</td><td class="r">${euro(summeOffen)}</td><td colspan="2"></td></tr>
</table>
<p class="klein">Offene Hauptforderung gesamt: <b>${euro(summeOffen)}</b>. Verzugszinsen und Mahnkosten sind nicht enthalten.</p>

<h2>2. Leistung (Rechnungspositionen aus Billomat)</h2>
${positionen}

<h2>3. Zahlungseingänge</h2>
${zahlungsTabelle}

<h2>4. Mahnstand je offener Rechnung</h2>
<table><tr><th>Rechnung</th><th>Höchste gesendete Stufe</th><th>Anzahl</th><th>Kategorie</th></tr>${stand}</table>
${mahnsperre.length ? `<div class="hinweis"><b>Aktuelle Sperre/Vereinbarung:</b> ${mahnsperre.map(esc).join(' · ')}</div>` : ''}

<h2>5. Chronologie: Rechnungen, Mahnungen, Kontakte, Zahlungen</h2>
${verlauf}

<h2>6. Aussagen und Zusagen des Schuldners</h2>
${liste(zusagen)}

<h2>7. Einwände des Schuldners</h2>
${liste(einwaende)}

<h2>8. Alle Gesprächsnotizen</h2>
${liste(notizen)}

${intern ? `<h2>9. Interne Hinweise (nicht an Dritte)</h2>${offen.map((r) => r.hinweise ? `<div class="intern"><b>${esc(r.rechnungsnummer)}</b> – ${esc(r.hinweise)}${r.naechster_schritt ? '<br><b>Nächster Schritt:</b> ' + esc(r.naechster_schritt) : ''}</div>` : '').join('') || '<p class="klein">keine</p>'}` : ''}

<h2>${intern ? '10' : '9'}. Anlagen</h2>
<ul>
${rechnungen.map((r) => `<li>Rechnung ${esc(r.rechnungsnummer)} vom ${de(r.datum)} – <a ${pdfAttr(r)}>Original-PDF aus Billomat</a></li>`).join('')}
${mahnungen.filter((m) => m.gmail_thread).map((m) => `<li>${esc(STUFEN[m.stufe] || 'Stufe ' + m.stufe)} ${de(m.gesendet_am)} (${esc(m.rechnungsnummer)}) – <a href="https://mail.google.com/mail/?authuser=${encodeURIComponent(GLAEUBIGER.email)}#all/thread-f:${esc(m.gmail_thread)}" target="_blank">Mail im Postfach</a></li>`).join('')}
</ul>
<p class="klein">Die Mahnschreiben liegen im Gmail-Postfach (Kopie an ${esc(GLAEUBIGER.mahnpostfach)}). Für die Weitergabe an ein Inkassounternehmen Rechnungs-PDFs und Mahnschreiben als Dateien beilegen.</p>

<div class="fuss">Forderungsakte ${esc(haupt.rechnungsnummer)} · ${esc(GLAEUBIGER.firma)} · erstellt ${de(heute)}<br>Die Unterlagen wurden mit KI-Unterstützung erstellt. Die Inhalte werden durch den Projektleiter geprüft.</div>
</div>
<script>
var AKTE_TOKEN=${JSON.stringify(String(token)).replace(/</g, "\\u003c")};
function oeffnePdf(id, re){
  fetch('/.netlify/functions/billomat-akte?rechnungsnummer='+encodeURIComponent(re)+'&pdf='+id,{headers:{'x-admin-token':AKTE_TOKEN}})
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.blob(); })
    .then(function(b){ var u=URL.createObjectURL(b); window.open(u,'_blank'); })
    .catch(function(e){ alert('PDF konnte nicht geladen werden: '+e.message); });
  return false;
}
</script>
</body></html>`;
}

exports.handler = async (event) => {
  const role = authorize(event);
  if (!role) return json(401, { ok: false, error: 'Unauthorized' });
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  const q = event.queryStringParameters || {};
  const re = String(q.rechnungsnummer || '').trim();
  if (!re) return json(400, { ok: false, error: 'rechnungsnummer erforderlich' });
  const token = (event.headers && (event.headers['x-admin-token'] || event.headers['X-Admin-Token'])) || q.token || '';

  try {
    const hauptRows = await sb.select('billomat_rechnungen', { select: '*', rechnungsnummer: `eq.${re}` });
    const haupt = hauptRows[0];
    if (!haupt) return json(404, { ok: false, error: `Rechnung ${re} nicht in der Datenbank` });

    // Original-PDF aus Billomat durchreichen
    if (q.pdf) {
      const pdf = await fetchPdf(q.pdf);
      if (!pdf || !pdf.base64file) return json(502, { ok: false, error: 'PDF nicht abrufbar' });
      return { statusCode: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${(pdf.filename || re + '.pdf').replace(/"/g, '')}"`, 'cache-control': 'no-store' }, body: pdf.base64file, isBase64Encoded: true };
    }

    // Alle Rechnungen des Kunden (offen + erledigt) aus der Datenbank
    const rechnungen = haupt.kunde_id
      ? await sb.select('billomat_rechnungen', { select: '*', kunde_id: `eq.${haupt.kunde_id}`, order: 'datum.asc' })
      : [haupt];
    const nummern = rechnungen.map((r) => r.rechnungsnummer);
    const inList = `in.(${nummern.map((n) => `"${n}"`).join(',')})`;
    const [mahnungen, notizen, zahlungen, kunde] = await Promise.all([
      sb.select('billomat_mahnungen', { select: '*', rechnungsnummer: inList, order: 'gesendet_am.asc,erstellt.asc' }),
      sb.select('billomat_notizen', { select: '*', rechnungsnummer: inList, order: 'erstellt.asc' }),
      sb.select('billomat_zahlungen', { select: '*', rechnungsnummer: inList, order: 'datum.asc' }),
      fetchClient(haupt.kunde_id)
    ]);
    const items = {};
    for (const r of rechnungen) items[r.rechnungsnummer] = await fetchItems(r.id);

    const intern = String(q.intern || '') === '1' && role === 'admin';
    const host = (event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || 'billomat-umsatz.netlify.app';
    const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const base = `${proto}://${host}/`;
    const html = renderHtml({ haupt, rechnungen, kunde, items, zahlungen, mahnungen, notizen, intern, token, base });
    return response(200, html, { 'content-type': 'text/html; charset=utf-8' });
  } catch (e) {
    return json(e.status && e.status >= 400 ? e.status : 502, { ok: false, error: e.message || 'Akte konnte nicht erstellt werden' });
  }
};
