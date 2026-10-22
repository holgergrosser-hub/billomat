/**
 * Netlify Function: Fälligkeitsliste für Zahlungserinnerungen (GET)
 *
 * Liefert alle offenen und überfälligen Billomat-Rechnungen mit Kunde,
 * E-Mail, Fälligkeit, Tagen überfällig und vorgeschlagener Mahnstufe.
 * Gedacht als Datenquelle für die geplante Claude-Aufgabe
 * „Zahlungserinnerungen" und die Seite „Tagesaktionen".
 *
 * Aufruf:
 *   GET /.netlify/functions/billomat-faellig
 *   Header  x-admin-token: <BILLOMAT_ADMIN_TOKEN>   (oder ?token=…)
 *   ?format=text   → kompakte Textliste statt JSON
 *
 * Mahnstufen (Vorschlag, Tage nach Fälligkeit):
 *   0–4   fällig, noch nichts tun
 *   5–13  Zahlungserinnerung
 *   14–27 1. Mahnung
 *   ab 28 2. Mahnung (letzte Zahlungsaufforderung)
 * Die Stufe ist ein Vorschlag aus dem Datum. Was wirklich schon
 * gesendet wurde, prüft die Claude-Aufgabe in Gmail.
 *
 * Env vars (Netlify): BILLOMAT_ID oder BILLOMAT_BASE_URL, BILLOMAT_API_KEY,
 * BILLOMAT_ADMIN_TOKEN
 */

'use strict';

const { billomatGetJson } = require('../../billomat/billomat-api');

const STUFEN = [
  { ab: 28, stufe: 3, name: '2. Mahnung' },
  { ab: 14, stufe: 2, name: '1. Mahnung' },
  { ab: 5, stufe: 1, name: 'Zahlungserinnerung' },
  { ab: 0, stufe: 0, name: 'fällig' }
];

function response(statusCode, body, contentType) {
  return {
    statusCode,
    headers: {
      'content-type': contentType || 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body
  };
}

function jsonResponse(statusCode, obj) {
  return response(statusCode, JSON.stringify(obj));
}

function headerValue(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return String(value || '');
  }
  return '';
}

function toArray(container, key) {
  if (!container) return [];
  const inner = container[key];
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === 'object') return [inner];
  return [];
}

function money(value) {
  const num = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

function formatEuro(num) {
  return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatDateDe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

function daysBetween(fromIso, toDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fromIso || ''));
  if (!m) return null;
  const from = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const to = Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate());
  return Math.floor((to - from) / 86400000);
}

function stufeFor(daysOverdue) {
  if (daysOverdue == null || daysOverdue < 0) return { stufe: 0, name: 'noch nicht fällig' };
  return STUFEN.find((s) => daysOverdue >= s.ab) || STUFEN[STUFEN.length - 1];
}

async function fetchInvoices(status) {
  const perPage = 100;
  let page = 1;
  let all = [];
  for (; page <= 50; page += 1) {
    const data = await billomatGetJson({
      path: '/api/invoices',
      query: { status, per_page: perPage, page }
    });
    const batch = toArray(data && data.invoices, 'invoice');
    all = all.concat(batch);
    const total = Number.parseInt(String(data?.invoices?.['@total'] ?? ''), 10);
    if (!batch.length || batch.length < perPage) break;
    if (Number.isFinite(total) && all.length >= total) break;
  }
  return all;
}

async function fetchClient(clientId, cache) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  let client = null;
  try {
    const data = await billomatGetJson({ path: `/api/clients/${id}` });
    client = data && data.client ? data.client : null;
  } catch {
    client = null;
  }
  cache.set(id, client);
  return client;
}

function toText(result) {
  const lines = [];
  lines.push(`Stand ${result.stand} – ${result.anzahl} offene Rechnungen, offen gesamt ${formatEuro(result.summe_offen)}, davon überfällig ${formatEuro(result.summe_ueberfaellig)}`);
  lines.push('');
  lines.push('Nr | Kunde | E-Mail | Datum | Fällig | Brutto | Offen | Tage überfällig | Vorschlag');
  for (const r of result.rechnungen) {
    lines.push([
      r.rechnungsnummer, r.kunde, r.email || '-', r.datum_de, r.faellig_de,
      formatEuro(r.brutto), formatEuro(r.offen), r.tage_ueberfaellig, r.stufe_name
    ].join(' | '));
  }
  return lines.join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  // Zwei gültige Token: der Admin-Token (schreibend, wie book-payment) und ein
  // eigener Lese-Token FAELLIG_TOKEN für die geplante Claude-Aufgabe.
  const validTokens = [process.env.BILLOMAT_ADMIN_TOKEN, process.env.FAELLIG_TOKEN]
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (!validTokens.length) {
    return jsonResponse(500, { ok: false, error: 'Server not configured: missing BILLOMAT_ADMIN_TOKEN/FAELLIG_TOKEN' });
  }
  const providedToken = (headerValue(event.headers, 'x-admin-token') || event.queryStringParameters?.token || '').trim();
  if (!providedToken || !validTokens.includes(providedToken)) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  try {
    const [open, overdue] = await Promise.all([fetchInvoices('OPEN'), fetchInvoices('OVERDUE')]);
    const seen = new Set();
    const invoices = [...overdue, ...open].filter((inv) => {
      const id = String(inv?.id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const today = new Date();
    const clientCache = new Map();
    const rows = [];
    for (const inv of invoices) {
      const client = await fetchClient(inv.client_id, clientCache);
      const brutto = money(inv.total_gross);
      const bezahlt = money(inv.paid_amount);
      const offen = inv.open_amount != null ? money(inv.open_amount) : Math.max(0, brutto - bezahlt);
      const tage = daysBetween(inv.due_date, today);
      const st = stufeFor(tage);
      rows.push({
        rechnung_id: Number(inv.id),
        rechnungsnummer: String(inv.invoice_number || ''),
        kunde_id: Number(inv.client_id) || null,
        kunde: String(client?.name || inv.client_name || '').trim(),
        ansprechpartner: [client?.salutation, client?.first_name, client?.last_name].filter(Boolean).join(' ').trim(),
        email: String(client?.email || '').trim(),
        datum: String(inv.date || ''),
        datum_de: formatDateDe(inv.date),
        faellig: String(inv.due_date || ''),
        faellig_de: formatDateDe(inv.due_date),
        brutto,
        bezahlt,
        offen,
        teilbezahlt: bezahlt > 0 && offen > 0,
        status: String(inv.status || ''),
        tage_ueberfaellig: tage,
        stufe: st.stufe,
        stufe_name: st.name,
        betreff_vorschlag: st.stufe === 1 ? `Zahlungserinnerung – Rechnung ${inv.invoice_number}`
          : st.stufe === 2 ? `1. Mahnung – Rechnung ${inv.invoice_number}`
          : st.stufe === 3 ? `2. Mahnung – Rechnung ${inv.invoice_number} – letzte Zahlungsaufforderung`
          : ''
      });
    }

    rows.sort((a, b) => (b.tage_ueberfaellig ?? -999) - (a.tage_ueberfaellig ?? -999));

    const result = {
      ok: true,
      stand: today.toISOString().slice(0, 10),
      anzahl: rows.length,
      summe_offen: Math.round(rows.reduce((s, r) => s + r.offen, 0) * 100) / 100,
      summe_ueberfaellig: Math.round(rows.filter((r) => (r.tage_ueberfaellig ?? -1) > 0).reduce((s, r) => s + r.offen, 0) * 100) / 100,
      stufen: STUFEN,
      rechnungen: rows
    };

    if (String(event.queryStringParameters?.format || '') === 'text') {
      return response(200, toText(result), 'text/plain; charset=utf-8');
    }
    return jsonResponse(200, result);
  } catch (e) {
    const statusCode = e.status && Number.isInteger(e.status) ? e.status : 502;
    return jsonResponse(statusCode, { ok: false, error: e.message || 'Billomat request failed', details: e.payload || null });
  }
};
