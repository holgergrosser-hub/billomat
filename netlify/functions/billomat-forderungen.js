/**
 * Netlify Function: Offene Forderungen aus der Supabase-DB (Spiegel von Billomat)
 * inkl. Mahnstand, Notizen und Vorschlag für die nächste Mahnstufe.
 *
 * GET  /.netlify/functions/billomat-forderungen
 *      Header x-admin-token: <BILLOMAT_ADMIN_TOKEN | FAELLIG_TOKEN | MAHN_TOKEN>  (oder ?token=…)
 *      ?format=text      kompakte Textliste
 *      ?detail=1         zusätzlich Mahnhistorie und Notizen je Rechnung
 *      ?alle=1           auch erledigte/bezahlte Rechnungen der letzten 60 Tage
 *
 * POST /.netlify/functions/billomat-forderungen   (JSON, Token wie oben)
 *      { aktion: 'mahnung', rechnungsnummer, stufe, status: 'entwurf'|'gesendet', gesendet_am?, betreff?, gmail_thread?, gmail_draft_id?, empfaenger?, kanal?, kommentar? }
 *      { aktion: 'mahnung_status', id, status: 'gesendet'|'verworfen', gesendet_am?, gmail_thread? }
 *      { aktion: 'notiz', rechnungsnummer, text, autor? }
 *      { aktion: 'sperre', rechnungsnummer, mahnsperre: string|null, mahnsperre_bis?: 'YYYY-MM-DD'|null }
 *      { aktion: 'kontakt', rechnungsnummer, email?, telefon?, mobil?, anrede?, vorname?, nachname? }
 *      { aktion: 'erledigt', rechnungsnummer, status?: 'PAID'|'CANCELED', bezahlt_am? }
 *
 * Mahnstufen: 0 Nachfrage/Kontakt, 1 Zahlungserinnerung, 2 1. Mahnung, 3 2. Mahnung, 4 letzte Frist.
 * Regeln (Tage ab Fälligkeit / seit letzter Stufe): 1 ab 5 Tagen; 2 ab 14 Tagen und >= 9 Tage nach Stufe 1;
 * 3 ab 28 Tagen und >= 14 Tage nach Stufe 2; danach ab 10 Tagen nach Stufe 3: Entscheidung Inkasso/Anruf.
 */

'use strict';

const { authorize, autorFuer } = require('../../billomat/auth');
const sb = require('../../billomat/supabase-rest');

function response(statusCode, body, contentType) {
  return {
    statusCode,
    headers: { 'content-type': contentType || 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body
  };
}
const json = (code, obj) => response(code, JSON.stringify(obj));

function formatDateDe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}
function formatEuro(num) {
  return Number(num || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function daysSince(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const from = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((to - from) / 86400000);
}
const STUFEN_NAME = { 0: 'Nachfrage', 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung', 4: 'Letzte Frist' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Vorschlag für die nächste Aktion aus Tagen überfällig, gesendeter Stufe und Sperre */
function naechsteAktion(r) {
  const tage = Number(r.tage_ueberfaellig ?? -999);
  const gesendet = Number(r.gesendete_stufe || 0);
  const seit = r.gesendet_am ? daysSince(r.gesendet_am) : null;
  const entwurf = Number(r.entwurf_stufe || 0);
  const sperreAktiv = Boolean(r.mahnsperre) && (!r.mahnsperre_bis || r.mahnsperre_bis >= todayIso());

  if (!r.email) return { stufe: null, aktion: 'email_fehlt', text: 'E-Mail-Adresse fehlt in Billomat' };
  if (sperreAktiv) return { stufe: null, aktion: 'gesperrt', text: `Nicht mahnen: ${r.mahnsperre}${r.mahnsperre_bis ? ' (bis ' + formatDateDe(r.mahnsperre_bis) + ')' : ''}` };
  if (entwurf > gesendet) return { stufe: entwurf, aktion: 'entwurf_vorhanden', text: `Entwurf Stufe ${entwurf} (${STUFEN_NAME[entwurf]}) liegt bereits in Gmail` };
  if (tage < 5) return { stufe: 0, aktion: 'warten', text: tage < 0 ? 'noch nicht fällig' : 'fällig, noch nichts tun' };
  if (gesendet === 0) return { stufe: 1, aktion: 'mahnung', text: 'Zahlungserinnerung senden' };
  if (gesendet === 1) {
    if (tage >= 14 && seit != null && seit >= 9) return { stufe: 2, aktion: 'mahnung', text: '1. Mahnung senden' };
    return { stufe: 0, aktion: 'warten', text: `Zahlungserinnerung vom ${formatDateDe(r.gesendet_am)} abwarten` };
  }
  if (gesendet === 2) {
    if (tage >= 28 && seit != null && seit >= 14) return { stufe: 3, aktion: 'mahnung', text: '2. Mahnung senden' };
    return { stufe: 0, aktion: 'warten', text: `1. Mahnung vom ${formatDateDe(r.gesendet_am)} abwarten` };
  }
  // Stufe 3 oder 4 gesendet
  if (seit != null && seit >= 10) return { stufe: null, aktion: 'entscheidung', text: 'Entscheidung: Inkasso/Mahnbescheid oder anrufen' };
  return { stufe: 0, aktion: 'warten', text: `${STUFEN_NAME[gesendet]} vom ${formatDateDe(r.gesendet_am)} abwarten` };
}

function enrich(r) {
  const next = naechsteAktion(r);
  return {
    ...r,
    brutto: Number(r.brutto), bezahlt: Number(r.bezahlt), offen: Number(r.offen),
    datum_de: formatDateDe(r.datum),
    faellig_de: formatDateDe(r.faellig),
    gesendet_am_de: formatDateDe(r.gesendet_am),
    gesendete_stufe_name: STUFEN_NAME[Number(r.gesendete_stufe || 0)] || '',
    tage_seit_mahnung: r.gesendet_am ? daysSince(r.gesendet_am) : null,
    naechste_stufe: next.stufe,
    naechste_aktion: next.aktion,
    naechste_aktion_text: next.text,
    betreff_vorschlag: next.stufe === 1 ? `Zahlungserinnerung – Rechnung ${r.rechnungsnummer}`
      : next.stufe === 2 ? `1. Mahnung – Rechnung ${r.rechnungsnummer}`
      : next.stufe === 3 ? `2. Mahnung – Rechnung ${r.rechnungsnummer} – letzte Zahlungsaufforderung`
      : ''
  };
}

function toText(result) {
  const lines = [];
  lines.push(`Stand ${result.stand} – ${result.anzahl} offene Rechnungen, offen gesamt ${formatEuro(result.summe_offen)}, davon überfällig ${formatEuro(result.summe_ueberfaellig)}`);
  lines.push('');
  lines.push('Nr | Kunde | E-Mail | Telefon | Datum | Fällig | Offen | Tage überfällig | Gesendet | Nächste Aktion');
  for (const r of result.rechnungen) {
    lines.push([
      r.rechnungsnummer, r.kunde, r.email || '-', [r.telefon, r.mobil].filter(Boolean).join(' / ') || '-',
      r.datum_de, r.faellig_de, formatEuro(r.offen), r.tage_ueberfaellig,
      r.gesendete_stufe ? `${r.gesendete_stufe_name} ${r.gesendet_am_de}` : '-',
      r.naechste_aktion_text
    ].join(' | '));
  }
  return lines.join('\n');
}

async function handleGet(event, role) {
  const q = event.queryStringParameters || {};
  const rows = await sb.select('billomat_offene_forderungen', { select: '*', order: 'tage_ueberfaellig.desc,rechnungsnummer.asc' });
  const rechnungen = rows.map(enrich);

  const result = {
    ok: true,
    rolle: role,
    stand: todayIso(),
    anzahl: rechnungen.length,
    summe_offen: Math.round(rechnungen.reduce((s, r) => s + r.offen, 0) * 100) / 100,
    summe_ueberfaellig: Math.round(rechnungen.filter((r) => r.tage_ueberfaellig > 0).reduce((s, r) => s + r.offen, 0) * 100) / 100,
    rechnungen
  };

  if (String(q.detail || '') === '1') {
    const nummern = rechnungen.map((r) => r.rechnungsnummer);
    if (nummern.length) {
      const inList = `in.(${nummern.map((n) => `"${n}"`).join(',')})`;
      const [mahnungen, notizen] = await Promise.all([
        sb.select('billomat_mahnungen', { select: '*', rechnungsnummer: inList, order: 'gesendet_am.asc,erstellt.asc' }),
        sb.select('billomat_notizen', { select: '*', rechnungsnummer: inList, order: 'erstellt.desc' })
      ]);
      for (const r of result.rechnungen) {
        r.mahnungen = mahnungen.filter((m) => m.rechnungsnummer === r.rechnungsnummer);
        r.notizen = notizen.filter((n) => n.rechnungsnummer === r.rechnungsnummer);
      }
    }
  }

  if (String(q.alle || '') === '1') {
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const erledigt = await sb.select('billomat_rechnungen', { select: 'id,rechnungsnummer,kunde,brutto,bezahlt,offen,status,bezahlt_am,erledigt_am', erledigt: 'eq.true', erledigt_am: `gte.${since}`, order: 'erledigt_am.desc' });
    result.erledigt = erledigt.map((r) => ({ ...r, bezahlt_am_de: formatDateDe(r.bezahlt_am) }));
  }

  if (String(q.format || '') === 'text') {
    return response(200, toText(result), 'text/plain; charset=utf-8');
  }
  return json(200, result);
}

async function handlePost(event, role) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
  const aktion = String(body.aktion || '');
  const re = String(body.rechnungsnummer || '').trim();

  if (aktion === 'mahnung') {
    const stufe = Number(body.stufe);
    if (!re || !Number.isInteger(stufe) || stufe < 0 || stufe > 4) return json(400, { ok: false, error: 'rechnungsnummer und stufe (0-4) erforderlich' });
    const status = body.status === 'gesendet' ? 'gesendet' : 'entwurf';
    const row = {
      rechnungsnummer: re, stufe, status,
      gesendet_am: status === 'gesendet' ? (body.gesendet_am || todayIso()) : null,
      betreff: body.betreff || null, kanal: body.kanal || 'gmail',
      gmail_thread: body.gmail_thread || null, gmail_draft_id: body.gmail_draft_id || null,
      empfaenger: body.empfaenger || null, quelle: body.quelle || autorFuer(role),
      kommentar: body.kommentar || null
    };
    const inserted = await sb.insert('billomat_mahnungen', [row]);
    return json(200, { ok: true, mahnung: inserted[0] });
  }

  if (aktion === 'mahnung_status') {
    const id = Number(body.id);
    if (!id || !['gesendet', 'verworfen', 'entwurf'].includes(body.status)) return json(400, { ok: false, error: 'id und status erforderlich' });
    const patch = { status: body.status };
    if (body.status === 'gesendet') patch.gesendet_am = body.gesendet_am || todayIso();
    if (body.gmail_thread) patch.gmail_thread = body.gmail_thread;
    const updated = await sb.update('billomat_mahnungen', patch, { id: `eq.${id}` });
    return json(200, { ok: true, mahnung: updated[0] || null });
  }

  if (aktion === 'notiz') {
    const text = String(body.text || '').trim();
    if (!re || !text) return json(400, { ok: false, error: 'rechnungsnummer und text erforderlich' });
    const inserted = await sb.insert('billomat_notizen', [{ rechnungsnummer: re, text, autor: body.autor || autorFuer(role), quelle: body.quelle || (role === 'read' ? 'mahnlauf' : 'dashboard') }]);
    return json(200, { ok: true, notiz: inserted[0] });
  }

  if (aktion === 'sperre') {
    if (!re) return json(400, { ok: false, error: 'rechnungsnummer erforderlich' });
    const patch = { mahnsperre: body.mahnsperre ? String(body.mahnsperre).trim() : null, mahnsperre_bis: body.mahnsperre_bis || null };
    const updated = await sb.update('billomat_rechnungen', patch, { rechnungsnummer: `eq.${re}` });
    return json(200, { ok: true, rechnung: updated[0] || null });
  }

  if (aktion === 'kontakt') {
    if (!re) return json(400, { ok: false, error: 'rechnungsnummer erforderlich' });
    const patch = {};
    for (const k of ['email', 'telefon', 'mobil', 'anrede', 'vorname', 'nachname']) {
      if (body[k] !== undefined) patch[k] = body[k] ? String(body[k]).trim() : null;
    }
    if (!Object.keys(patch).length) return json(400, { ok: false, error: 'keine Felder' });
    const updated = await sb.update('billomat_rechnungen', patch, { rechnungsnummer: `eq.${re}` });
    return json(200, { ok: true, rechnung: updated[0] || null });
  }

  if (aktion === 'erledigt') {
    if (role !== 'admin') return json(403, { ok: false, error: 'Admin-Token erforderlich' });
    if (!re) return json(400, { ok: false, error: 'rechnungsnummer erforderlich' });
    const patch = { erledigt: true, erledigt_am: new Date().toISOString(), status: body.status || 'PAID', bezahlt_am: body.bezahlt_am || todayIso() };
    const updated = await sb.update('billomat_rechnungen', patch, { rechnungsnummer: `eq.${re}` });
    return json(200, { ok: true, rechnung: updated[0] || null });
  }

  return json(400, { ok: false, error: `Unbekannte aktion: ${aktion}` });
}

exports.handler = async (event) => {
  const role = authorize(event);
  if (!role) return json(401, { ok: false, error: 'Unauthorized' });
  try {
    if (event.httpMethod === 'GET') return await handleGet(event, role);
    if (event.httpMethod === 'POST') return await handlePost(event, role);
    return json(405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    const statusCode = e.status && Number.isInteger(e.status) && e.status >= 400 ? e.status : 502;
    return json(statusCode, { ok: false, error: e.message || 'Request failed', details: e.payload || null });
  }
};
