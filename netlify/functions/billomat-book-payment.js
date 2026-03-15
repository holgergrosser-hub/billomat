/**
 * Netlify Function: Book a payment for a Billomat invoice.
 *
 * Billomat API: POST /api/invoice-payments
 * Docs: https://www.billomat.com/api/rechnungen/zahlungen/
 *
 * Env vars (Netlify):
 * - BILLOMAT_ID or BILLOMAT_BASE_URL
 * - BILLOMAT_API_KEY
 * - BILLOMAT_ADMIN_TOKEN (shared secret for write operations)
 *
 * Request:
 * - Method: POST
 * - Header: x-admin-token: <token>
 * - Body JSON:
 *   {
 *     "invoiceId": 123,
 *     "date": "YYYY-MM-DD",
 *     "amount": 1190.00,
 *     "comment": "Sparkasse ...",
 *     "type": "BANK_TRANSFER",
 *     "markInvoiceAsPaid": true
 *   }
 */

'use strict';

const { billomatPostJson } = require('../../billomat/billomat-api');

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,x-admin-token',
      'access-control-allow-methods': 'POST,OPTIONS'
    },
    body: JSON.stringify(bodyObj)
  };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {});
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  const requiredToken = String(process.env.BILLOMAT_ADMIN_TOKEN || '').trim();
  if (!requiredToken) {
    return jsonResponse(500, { ok: false, error: 'Server not configured: missing BILLOMAT_ADMIN_TOKEN' });
  }

  const providedToken = String(event.headers?.['x-admin-token'] || event.headers?.['X-Admin-Token'] || '').trim();
  if (!providedToken || providedToken !== requiredToken) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const invoiceId = Number(payload.invoiceId);
  const date = String(payload.date || '').trim();
  const amount = Number(payload.amount);
  const comment = String(payload.comment || '').trim();
  const type = String(payload.type || 'BANK_TRANSFER').trim();
  const markInvoiceAsPaid = Boolean(payload.markInvoiceAsPaid ?? true);

  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    return jsonResponse(400, { ok: false, error: 'invoiceId missing/invalid' });
  }
  if (date && !isIsoDate(date)) {
    return jsonResponse(400, { ok: false, error: 'Invalid date (YYYY-MM-DD)' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse(400, { ok: false, error: 'amount missing/invalid' });
  }

  try {
    // Billomat expects a root object "invoice-payment" when using JSON.
    const billomatBody = {
      'invoice-payment': {
        invoice_id: invoiceId,
        date: date || undefined,
        amount,
        comment: comment || undefined,
        type: type || undefined,
        mark_invoice_as_paid: markInvoiceAsPaid ? 1 : 0
      }
    };

    const data = await billomatPostJson({
      path: '/api/invoice-payments',
      bodyObj: billomatBody
    });

    return jsonResponse(200, { ok: true, data });
  } catch (e) {
    const statusCode = e.status && Number.isInteger(e.status) ? e.status : 502;
    return jsonResponse(statusCode, {
      ok: false,
      error: e.message || 'Billomat request failed',
      details: e.payload || null
    });
  }
};
