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
