'use strict';

function headerValue(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return String(value || '');
  }
  return '';
}

function providedToken(event) {
  return (headerValue(event.headers, 'x-admin-token') || event.queryStringParameters?.token || '').trim();
}

/**
 * Prüft den Token. Gültig sind BILLOMAT_ADMIN_TOKEN (schreibend) und – wenn
 * allowReadToken=true – zusätzlich FAELLIG_TOKEN (nur lesend / Mahnlauf).
 * Rückgabe: 'admin' | 'read' | null
 */
function authorize(event, { allowReadToken = true } = {}) {
  const admin = String(process.env.BILLOMAT_ADMIN_TOKEN || '').trim();
  const read = String(process.env.FAELLIG_TOKEN || '').trim();
  const given = providedToken(event);
  if (!given) return null;
  if (admin && given === admin) return 'admin';
  if (allowReadToken && read && given === read) return 'read';
  return null;
}

module.exports = { headerValue, providedToken, authorize };
