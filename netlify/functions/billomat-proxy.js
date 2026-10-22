/**
 * Netlify Function: Billomat-Proxy für Google Apps Script
 *
 * Hintergrund (22.10.2026): Cloudflare vor billomat.net blockt die Google-
 * Server-IPs, von denen Apps Script (UrlFetchApp) seine Anfragen schickt
 * (HTTP 403 "Sorry, you have been blocked"). Netlify-Server sind nicht
 * betroffen. Diese Funktion reicht Anfragen 1:1 an die Billomat-API weiter.
 *
 * Aufruf (über den Redirect in netlify.toml):
 *   https://<site>.netlify.app/billomat-api/api/clients?name=...
 *   → https://<BILLOMAT_ID>.billomat.net/api/clients?name=...
 *
 * Methode, Query-String, Body und Content-Type werden unverändert
 * durchgereicht. Der API-Key kommt aus der Netlify-Umgebung, nie vom Aufrufer.
 *
 * Schutz: Header  x-admin-token: <BILLOMAT_ADMIN_TOKEN>  (wie book-payment)
 *
 * Env vars (Netlify) – alle bereits vorhanden:
 * - BILLOMAT_ID oder BILLOMAT_BASE_URL
 * - BILLOMAT_API_KEY
 * - BILLOMAT_ADMIN_TOKEN
 */

'use strict';

const { buildBaseUrl } = require('../../billomat/billomat-api');

const FUNCTION_PREFIX = '/.netlify/functions/billomat-proxy';
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

function textResponse(statusCode, body, contentType) {
  return {
    statusCode,
    headers: {
      'content-type': contentType || 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body
  };
}

function errorResponse(statusCode, message) {
  return textResponse(statusCode, JSON.stringify({ ok: false, error: message }));
}

function headerValue(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return String(value || '');
  }
  return '';
}

function billomatPathFromEvent(event) {
  // event.path ist nach dem Redirect z. B. "/.netlify/functions/billomat-proxy/api/clients"
  let path = String(event.path || '');
  if (path.startsWith(FUNCTION_PREFIX)) {
    path = path.slice(FUNCTION_PREFIX.length);
  }
  if (!path.startsWith('/')) path = '/' + path;
  return path;
}

exports.handler = async (event) => {
  const method = String(event.httpMethod || 'GET').toUpperCase();

  if (!ALLOWED_METHODS.has(method)) {
    return errorResponse(405, 'Method not allowed');
  }

  const requiredToken = String(process.env.BILLOMAT_ADMIN_TOKEN || '').trim();
  if (!requiredToken) {
    return errorResponse(500, 'Server not configured: missing BILLOMAT_ADMIN_TOKEN');
  }
  const providedToken = headerValue(event.headers, 'x-admin-token').trim();
  if (!providedToken || providedToken !== requiredToken) {
    return errorResponse(401, 'Unauthorized');
  }

  const baseUrl = buildBaseUrl();
  const apiKey = String(process.env.BILLOMAT_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return errorResponse(500, 'Server not configured: missing BILLOMAT_ID/BILLOMAT_BASE_URL or BILLOMAT_API_KEY');
  }

  const billomatPath = billomatPathFromEvent(event);
  if (!billomatPath.startsWith('/api/')) {
    return errorResponse(400, 'Only /api/... paths are allowed');
  }

  const rawQuery = String(event.rawQuery || '');
  const targetUrl = baseUrl + billomatPath + (rawQuery ? '?' + rawQuery : '');

  const forwardHeaders = {
    'X-BillomatApiKey': apiKey,
    'Accept': headerValue(event.headers, 'accept') || 'application/json'
  };
  const contentType = headerValue(event.headers, 'content-type');
  if (contentType) forwardHeaders['Content-Type'] = contentType;

  let body;
  if (method !== 'GET' && event.body) {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  }

  try {
    const res = await fetch(targetUrl, { method, headers: forwardHeaders, body });
    const text = await res.text();
    const resContentType = res.headers.get('content-type') || 'application/json; charset=utf-8';
    return textResponse(res.status, text, resContentType);
  } catch (e) {
    return errorResponse(502, `Billomat request failed: ${e.message || e}`);
  }
};
