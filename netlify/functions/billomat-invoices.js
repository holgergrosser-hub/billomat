/**
 * Netlify Function: Billomat invoices (GET-only)
 *
 * Env vars (Netlify):
 * - BILLOMAT_ID (e.g. "mycompany") OR BILLOMAT_BASE_URL (e.g. "https://mycompany.billomat.net")
 * - BILLOMAT_API_KEY
 * Optional:
 * - BILLOMAT_MOCK=1 (returns TEST/billomat/mock-invoices.json)
 * - BILLOMAT_FUTURE_YEARS=2 (adds empty months for currentYear+N)
 *
 * Query params:
 * - status (e.g. OPEN)
 * - from (YYYY-MM-DD)
 * - to (YYYY-MM-DD)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { billomatGetJson } = require('../../billomat/billomat-api');

function jsonResponse(statusCode, bodyObj, extraHeaders) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,OPTIONS',
      ...extraHeaders
    },
    body: JSON.stringify(bodyObj)
  };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseMoney(value) {
  if (value == null) return 0;
  const str = String(value).trim().replace(',', '.');
  const num = Number(str);
  return Number.isFinite(num) ? num : 0;
}

function pickInvoiceDate(invoice) {
  return (
    invoice.invoice_date ||
    invoice.date ||
    invoice.created ||
    invoice.created_at ||
    invoice.updated_at ||
    invoice.due_date ||
    ''
  );
}

function monthKey(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function buildEmptyMonthMap({ fromYear, toYear }) {
  const result = new Map();
  for (let year = fromYear; year <= toYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      result.set(key, {
        month: key,
        year,
        count: 0,
        netTotal: 0,
        grossTotal: 0,
        openNetTotal: 0,
        paidNetTotal: 0,
        statusCounts: {}
      });
    }
  }
  return result;
}

function normalizeInvoicesPayload(data) {
  // Billomat might return {invoices:[...]}, {invoices:{invoice:[...]}} or {invoice:[...]} etc.
  if (!data) return [];
  if (Array.isArray(data.invoices)) return data.invoices;
  if (data.invoices && Array.isArray(data.invoices.invoice)) return data.invoices.invoice;
  if (Array.isArray(data.invoice)) return data.invoice;
  if (data.invoices && typeof data.invoices === 'object') {
    // Sometimes: {invoices: { invoice: {...} }}
    if (data.invoices.invoice && !Array.isArray(data.invoices.invoice)) return [data.invoices.invoice];
  }
  return [];
}

function normalizeClientsPayload(data) {
  if (!data) return [];
  if (Array.isArray(data.clients)) return data.clients;
  if (data.clients && Array.isArray(data.clients.client)) return data.clients.client;
  if (Array.isArray(data.client)) return data.client;
  if (data.client && !Array.isArray(data.client) && typeof data.client === 'object') return [data.client];
  if (data.clients && typeof data.clients === 'object') {
    if (data.clients.client && !Array.isArray(data.clients.client)) return [data.clients.client];
  }
  return [];
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchClientsByInvoiceIds(invoiceIds) {
  const uniqueIds = Array.from(new Set((invoiceIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  if (!uniqueIds.length) return [];

  const chunks = chunkArray(uniqueIds, 50);
  const allClients = [];

  for (const ids of chunks) {
    const data = await billomatGetJson({
      path: '/api/clients',
      query: {
        invoice_id: ids.join(','),
        per_page: 100
      }
    });

    allClients.push(...normalizeClientsPayload(data));
  }

  return allClients;
}

async function fetchClientForInvoiceId(invoiceId) {
  const id = String(invoiceId || '').trim();
  if (!id) return null;

  const data = await billomatGetJson({
    path: '/api/clients',
    query: {
      invoice_id: id,
      per_page: 10
    }
  });

  return normalizeClientsPayload(data)[0] || null;
}

function extractInvoiceClientId(invoice) {
  const candidates = [
    invoice?.client_id,
    invoice?.client?.id,
    invoice?.client?.client_id,
    invoice?.customer_id,
    invoice?.customer?.id
  ];

  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }

  return '';
}

function buildClientIdMap(clients) {
  const map = new Map();
  for (const client of clients) {
    const clientId = String(client?.id || '').trim();
    if (clientId && !map.has(clientId)) {
      map.set(clientId, client);
    }
  }
  return map;
}

function buildClientInvoiceMap(clients) {
  const map = new Map();

  for (const client of clients) {
    const invoicesRaw = client?.invoice_id ?? client?.invoice_ids ?? client?.invoices ?? client?.invoice;
    const invoiceIds = [];

    if (Array.isArray(invoicesRaw)) {
      for (const item of invoicesRaw) {
        const id = item?.id ?? item;
        if (id != null && String(id).trim()) invoiceIds.push(String(id).trim());
      }
    } else if (typeof invoicesRaw === 'string') {
      for (const part of invoicesRaw.split(',')) {
        const id = String(part || '').trim();
        if (id) invoiceIds.push(id);
      }
    } else if (invoicesRaw && typeof invoicesRaw === 'object') {
      const nested = invoicesRaw.id ?? invoicesRaw['@id'] ?? invoicesRaw.invoice_id;
      if (nested != null && String(nested).trim()) invoiceIds.push(String(nested).trim());
    } else if (invoicesRaw != null && String(invoicesRaw).trim()) {
      invoiceIds.push(String(invoicesRaw).trim());
    }

    for (const invoiceId of invoiceIds) {
      if (!map.has(invoiceId)) {
        map.set(invoiceId, client);
      }
    }
  }

  return map;
}

function enrichInvoicesWithClientData(invoices, clients) {
  const clientByInvoiceId = buildClientInvoiceMap(clients);
  const clientById = buildClientIdMap(clients);

  return invoices.map((invoice) => {
    const invoiceId = String(invoice?.id || '').trim();
    const invoiceClientId = extractInvoiceClientId(invoice);
    const client = clientById.get(invoiceClientId) || clientByInvoiceId.get(invoiceId);
    if (!client) return invoice;

    const clientNumber = client.client_number || invoice.client_number || invoice.customer_number || '';
    const clientCode = client.number_pre && client.number != null
      ? `${client.number_pre}${client.number}`
      : (client.number != null ? String(client.number) : '');

    return {
      ...invoice,
      client_name: invoice.client_name || client.name || invoice.client || '',
      client_number: clientNumber || clientCode || invoice.client_number || '',
      customer_number: clientNumber || clientCode || invoice.customer_number || '',
      client_id: invoice.client_id || invoiceClientId || client.id || '',
      client: {
        ...(invoice.client && typeof invoice.client === 'object' ? invoice.client : {}),
        id: invoice.client?.id || invoiceClientId || client.id || '',
        name: invoice.client?.name || client.name || invoice.client_name || '',
        client_number: invoice.client?.client_number || clientNumber || clientCode || '',
        number: invoice.client?.number || client.number || '',
        number_pre: invoice.client?.number_pre || client.number_pre || ''
      }
    };
  });
}

async function enrichInvoicesWithClientDataViaApi(invoices, { allowPerInvoiceFallback = false } = {}) {
  const baseClients = await fetchClientsByInvoiceIds(invoices.map(inv => inv?.id));
  let enriched = enrichInvoicesWithClientData(invoices, baseClients);

  if (!allowPerInvoiceFallback) {
    return enriched;
  }

  const unresolved = enriched.filter(inv => {
    const hasCustomerNumber = String(inv?.client_number || inv?.customer_number || inv?.client?.client_number || '').trim();
    return !hasCustomerNumber;
  });

  if (!unresolved.length) {
    return enriched;
  }

  const fallbackClients = [];
  for (const invoice of unresolved) {
    try {
      const client = await fetchClientForInvoiceId(invoice?.id);
      if (client) fallbackClients.push(client);
    } catch {
      // Keep invoice response usable even if single-client lookup fails.
    }
  }

  if (!fallbackClients.length) {
    return enriched;
  }

  enriched = enrichInvoicesWithClientData(enriched, fallbackClients);
  return enriched;
}

function readTotalCount(data) {
  const raw = data?.invoices?.['@total'] ?? data?.invoices?.total ?? data?.['@total'] ?? data?.total;
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

async function fetchAllInvoicesViaApi({ status, from, to }) {
  const perPage = 100;
  const maxPages = 200; // safety cap
  let page = 1;
  let all = [];
  let total = 0;

  while (page <= maxPages) {
    const data = await billomatGetJson({
      path: '/api/invoices',
      query: {
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        per_page: perPage,
        page
      }
    });

    if (!total) total = readTotalCount(data);
    const batch = normalizeInvoicesPayload(data);
    if (!batch.length) break;

    all = all.concat(batch);

    if (total && all.length >= total) break;
    if (!total && batch.length < perPage) break;
    page += 1;
  }

  return all;
}

function computeMonthlySummary(invoices, { futureYearsToAdd }) {
  let minYear = new Date().getUTCFullYear();
  let maxYear = new Date().getUTCFullYear();

  for (const inv of invoices) {
    const key = monthKey(pickInvoiceDate(inv));
    if (!key) continue;
    const year = Number(key.slice(0, 4));
    if (Number.isFinite(year)) {
      minYear = Math.min(minYear, year);
      maxYear = Math.max(maxYear, year);
    }
  }

  const currentYear = new Date().getUTCFullYear();
  const toYear = Math.max(maxYear, currentYear + futureYearsToAdd);
  const fromYear = Math.min(minYear, currentYear);

  const months = buildEmptyMonthMap({ fromYear, toYear });

  for (const inv of invoices) {
    const key = monthKey(pickInvoiceDate(inv));
    if (!key || !months.has(key)) continue;

    const status = String(inv.status || 'UNKNOWN').toUpperCase();
    const net = parseMoney(inv.total_net ?? inv.net_total ?? inv.amount_net ?? inv.totalNet);
    const gross = parseMoney(inv.total_gross ?? inv.gross_total ?? inv.amount_gross ?? inv.totalGross);

    const entry = months.get(key);
    entry.count += 1;
    entry.netTotal += net;
    entry.grossTotal += gross;

    if (status === 'OPEN' || status === 'OVERDUE' || status === 'DUE') {
      entry.openNetTotal += net;
    }
    if (status === 'PAID') {
      entry.paidNetTotal += net;
    }

    entry.statusCounts[status] = (entry.statusCounts[status] || 0) + 1;
  }

  const byMonth = Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month));

  const byYear = new Map();
  for (const row of byMonth) {
    const y = row.year;
    if (!byYear.has(y)) {
      byYear.set(y, {
        year: y,
        count: 0,
        netTotal: 0,
        grossTotal: 0,
        openNetTotal: 0,
        paidNetTotal: 0,
        statusCounts: {}
      });
    }
    const agg = byYear.get(y);
    agg.count += row.count;
    agg.netTotal += row.netTotal;
    agg.grossTotal += row.grossTotal;
    agg.openNetTotal += row.openNetTotal;
    agg.paidNetTotal += row.paidNetTotal;
    for (const [s, c] of Object.entries(row.statusCounts)) {
      agg.statusCounts[s] = (agg.statusCounts[s] || 0) + c;
    }
  }

  return {
    byMonth,
    byYear: Array.from(byYear.values()).sort((a, b) => a.year - b.year)
  };
}

function loadMockInvoices() {
  const mockPath = path.resolve(__dirname, '../../billomat/mock-invoices.json');
  const text = fs.readFileSync(mockPath, 'utf8');
  const data = JSON.parse(text);
  return data.invoices || [];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, { 'content-length': '0' });
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  const qs = event.queryStringParameters || {};
  const status = qs.status ? String(qs.status).trim() : '';
  const from = qs.from ? String(qs.from).trim() : '';
  const to = qs.to ? String(qs.to).trim() : '';

  if (from && !isIsoDate(from)) {
    return jsonResponse(400, { ok: false, error: 'Invalid from date (YYYY-MM-DD)' });
  }
  if (to && !isIsoDate(to)) {
    return jsonResponse(400, { ok: false, error: 'Invalid to date (YYYY-MM-DD)' });
  }

  const futureYearsToAdd = Math.max(0, Number(process.env.BILLOMAT_FUTURE_YEARS || 2) || 0);
  const useMock = String(process.env.BILLOMAT_MOCK || '').trim() === '1';

  try {
    let invoices;

    if (useMock) {
      invoices = loadMockInvoices();
    } else {
      invoices = await fetchAllInvoicesViaApi({ status, from, to });
      invoices = await enrichInvoicesWithClientDataViaApi(invoices, {
        allowPerInvoiceFallback: status === 'OPEN' || status === 'OVERDUE' || status === 'DUE'
      });
    }

    const summary = computeMonthlySummary(invoices, { futureYearsToAdd });

    return jsonResponse(200, {
      ok: true,
      meta: {
        count: invoices.length,
        mock: useMock,
        filters: { status: status || null, from: from || null, to: to || null },
        futureYearsToAdd
      },
      invoices,
      summary
    });
  } catch (e) {
    const statusCode = e.status && Number.isInteger(e.status) ? e.status : 502;
    return jsonResponse(statusCode, {
      ok: false,
      error: e.message || 'Billomat request failed',
      details: e.payload || null
    });
  }
};
