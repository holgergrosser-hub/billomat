/**
 * Täglicher Abgleich Billomat → Supabase (Tabellen billomat_*).
 *
 * 1. Alle offenen/überfälligen Rechnungen aus Billomat holen (OPEN + OVERDUE),
 *    Kundendaten (E-Mail, Telefon, Ansprechpartner) ergänzen und in
 *    billomat_rechnungen upserten.
 * 2. Rechnungen, die in der DB noch offen sind, aber in Billomat nicht mehr
 *    offen: Einzelabruf in Billomat → Status (PAID/CANCELED/…), Zahlungen
 *    nach billomat_zahlungen, Rechnung als erledigt markieren.
 * 3. Teilzahlungen offener Rechnungen ebenfalls nach billomat_zahlungen.
 * 4. Lauf in billomat_sync_log protokollieren.
 *
 * Die Sparkasse-Eingänge gleicht Billomat selbst ab – hier wird nur gespiegelt.
 */

'use strict';

const { billomatGetJson } = require('./billomat-api');
const sb = require('./supabase-rest');

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

function isoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function clean(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

async function fetchInvoices(status) {
  const perPage = 100;
  let all = [];
  for (let page = 1; page <= 50; page += 1) {
    const data = await billomatGetJson({ path: '/api/invoices', query: { status, per_page: perPage, page } });
    const batch = toArray(data && data.invoices, 'invoice');
    all = all.concat(batch);
    const total = Number.parseInt(String(data?.invoices?.['@total'] ?? ''), 10);
    if (!batch.length || batch.length < perPage) break;
    if (Number.isFinite(total) && all.length >= total) break;
  }
  return all;
}

async function fetchInvoice(id) {
  try {
    const data = await billomatGetJson({ path: `/api/invoices/${id}` });
    return data && data.invoice ? data.invoice : null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
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

async function fetchPayments(invoiceId) {
  try {
    const data = await billomatGetJson({ path: '/api/invoice-payments', query: { invoice_id: invoiceId, per_page: 100 } });
    return toArray(data && data['invoice-payments'], 'invoice-payment');
  } catch {
    return [];
  }
}

function rowFromInvoice(inv, client) {
  const brutto = money(inv.total_gross);
  const bezahlt = money(inv.paid_amount);
  const offen = inv.open_amount != null ? money(inv.open_amount) : Math.max(0, brutto - bezahlt);
  const row = {
    id: Number(inv.id),
    rechnungsnummer: String(inv.invoice_number || `ID${inv.id}`),
    kunde_id: Number(inv.client_id) || null,
    kunde: String(client?.name || inv.client_name || '').trim(),
    datum: isoDate(inv.date),
    faellig: isoDate(inv.due_date),
    brutto,
    bezahlt,
    offen,
    status: String(inv.status || 'OPEN').toUpperCase(),
    zuletzt_gesehen: new Date().toISOString()
  };
  if (client) {
    const nr = client.client_number || (client.number_pre != null && client.number != null ? `${client.number_pre}${client.number}` : null);
    Object.assign(row, {
      kundennummer: clean(nr),
      anrede: clean(client.salutation),
      vorname: clean(client.first_name),
      nachname: clean(client.last_name),
      email: clean(client.email),
      telefon: clean(client.phone),
      mobil: clean(client.mobile)
    });
    // Nur Felder überschreiben, die Billomat auch liefert (sonst bleiben manuell gepflegte Werte stehen)
    for (const k of ['kundennummer', 'anrede', 'vorname', 'nachname', 'email', 'telefon', 'mobil']) {
      if (row[k] == null) delete row[k];
    }
  }
  return row;
}

function paymentRows(invoice, payments) {
  return payments
    .filter((p) => p && p.id)
    .map((p) => ({
      id: Number(p.id),
      rechnung_id: Number(invoice.id),
      rechnungsnummer: String(invoice.invoice_number || `ID${invoice.id}`),
      datum: isoDate(p.date),
      betrag: money(p.amount),
      typ: clean(p.type),
      kommentar: clean(p.comment)
    }));
}

async function syncForderungen({ log = () => {} } = {}) {
  const started = new Date();
  const result = { ok: true, stand: started.toISOString().slice(0, 10), anzahl_offen: 0, neu: 0, aktualisiert: 0, bezahlt: 0, erledigt: [], fehler: null };

  try {
    // 1) Offene Rechnungen aus Billomat
    const [open, overdue] = await Promise.all([fetchInvoices('OPEN'), fetchInvoices('OVERDUE')]);
    const seen = new Map();
    for (const inv of [...overdue, ...open]) {
      const id = String(inv?.id || '');
      if (id && !seen.has(id)) seen.set(id, inv);
    }
    const invoices = Array.from(seen.values());
    result.anzahl_offen = invoices.length;
    log(`Billomat: ${invoices.length} offene Rechnungen`);

    // Bisheriger DB-Stand
    const dbRows = await sb.select('billomat_rechnungen', { select: 'id,rechnungsnummer,erledigt,bezahlt', erledigt: 'eq.false' });
    const dbById = new Map(dbRows.map((r) => [String(r.id), r]));

    // 2) Upsert der offenen Rechnungen
    const clientCache = new Map();
    const rows = [];
    const paymentBatch = [];
    for (const inv of invoices) {
      const client = await fetchClient(inv.client_id, clientCache);
      const row = rowFromInvoice(inv, client);
      row.erledigt = false;
      row.erledigt_am = null;
      row.bezahlt_am = null;
      rows.push(row);
      if (dbById.has(String(inv.id))) result.aktualisiert += 1; else result.neu += 1;
      if (money(inv.paid_amount) > 0) {
        const payments = await fetchPayments(inv.id);
        paymentBatch.push(...paymentRows(inv, payments));
      }
    }
    for (let i = 0; i < rows.length; i += 50) {
      await sb.upsert('billomat_rechnungen', rows.slice(i, i + 50), 'id');
    }
    if (paymentBatch.length) await sb.upsert('billomat_zahlungen', paymentBatch, 'id');

    // 3) Nicht mehr offen → Einzelprüfung
    const openIds = new Set(invoices.map((inv) => String(inv.id)));
    for (const dbRow of dbRows) {
      if (openIds.has(String(dbRow.id))) continue;
      const inv = await fetchInvoice(dbRow.id);
      const status = inv ? String(inv.status || '').toUpperCase() : 'UNBEKANNT';
      if (inv && (status === 'OPEN' || status === 'OVERDUE' || status === 'DRAFT')) {
        // Taucht nicht in der Liste auf, ist aber laut Einzelabruf noch offen – nur Status aktualisieren
        await sb.update('billomat_rechnungen', { status, zuletzt_gesehen: new Date().toISOString() }, { id: `eq.${dbRow.id}` });
        continue;
      }
      const payments = inv ? await fetchPayments(inv.id) : [];
      const payRows = inv ? paymentRows(inv, payments) : [];
      if (payRows.length) await sb.upsert('billomat_zahlungen', payRows, 'id');
      const lastPayDate = payRows.map((p) => p.datum).filter(Boolean).sort().pop() || null;
      const patch = {
        status,
        erledigt: true,
        erledigt_am: new Date().toISOString(),
        bezahlt_am: status === 'PAID' ? (lastPayDate || new Date().toISOString().slice(0, 10)) : null,
        zuletzt_gesehen: new Date().toISOString()
      };
      if (inv) {
        patch.bezahlt = money(inv.paid_amount);
        patch.offen = inv.open_amount != null ? money(inv.open_amount) : 0;
      }
      await sb.update('billomat_rechnungen', patch, { id: `eq.${dbRow.id}` });
      if (status === 'PAID') result.bezahlt += 1;
      result.erledigt.push({ rechnungsnummer: dbRow.rechnungsnummer, status, bezahlt_am: patch.bezahlt_am });
      log(`${dbRow.rechnungsnummer}: ${status}${patch.bezahlt_am ? ' am ' + patch.bezahlt_am : ''}`);
    }
  } catch (e) {
    result.ok = false;
    result.fehler = e.message || String(e);
    log(`Fehler: ${result.fehler}`);
  }

  try {
    await sb.insert('billomat_sync_log', [{
      gestartet: started.toISOString(),
      beendet: new Date().toISOString(),
      anzahl_offen: result.anzahl_offen,
      neu: result.neu,
      aktualisiert: result.aktualisiert,
      bezahlt: result.bezahlt,
      fehler: result.fehler
    }]);
  } catch (e) {
    log(`Sync-Log konnte nicht geschrieben werden: ${e.message}`);
  }

  return result;
}

module.exports = { syncForderungen };
