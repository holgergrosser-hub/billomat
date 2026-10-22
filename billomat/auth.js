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
 * Prüft den Token. Gültig sind
 * - BILLOMAT_ADMIN_TOKEN  → 'admin' (alles, auch Buchen/Erledigt)
 * - FAELLIG_TOKEN         → 'read'  (Mahnlauf: lesen, Mahnungen/Notizen/Sperren schreiben)
 * - MAHN_TOKEN            → 'mahn'  (externe Mahnkraft: wie 'read', eigener Token, einzeln sperrbar)
 * Die beiden letzten nur, wenn allowReadToken=true.
 * Rückgabe: 'admin' | 'read' | 'mahn' | null
 */
function authorize(event, { allowReadToken = true } = {}) {
  const admin = String(process.env.BILLOMAT_ADMIN_TOKEN || '').trim();
  const read = String(process.env.FAELLIG_TOKEN || '').trim();
  const mahn = String(process.env.MAHN_TOKEN || '').trim();
  const given = providedToken(event);
  if (!given) return null;
  if (admin && given === admin) return 'admin';
  if (allowReadToken && read && given === read) return 'read';
  if (allowReadToken && mahn && given === mahn) return 'mahn';
  return null;
}

/** Standard-Autor/Quelle je Rolle für Notizen und Mahnungen */
function autorFuer(role) {
  return role === 'admin' ? 'holger' : role === 'mahn' ? 'mahnkraft' : 'mahnlauf';
}

module.exports = { headerValue, providedToken, authorize, autorFuer };
