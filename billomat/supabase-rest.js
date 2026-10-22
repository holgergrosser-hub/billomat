/**
 * Minimaler Supabase-REST-Client (PostgREST) für die Netlify-Funktionen.
 * Keine Abhängigkeit auf supabase-js – nur fetch.
 *
 * Env vars (Netlify):
 * - SUPABASE_URL                z. B. https://jrzioeixdxkhlazclzpo.supabase.co
 * - SUPABASE_SERVICE_ROLE_KEY   Service-Role-Key (nur serverseitig! RLS ist aktiv, anon hat keinen Zugriff)
 */

'use strict';

function cfg() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    const err = new Error('Server not configured: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    err.status = 500;
    throw err;
  }
  return { url, key };
}

async function request(method, table, { query, body, prefer } = {}) {
  const { url, key } = cfg();
  const target = new URL(`${url}/rest/v1/${table}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      target.searchParams.set(k, String(v));
    }
  }
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const msg = data && (data.message || data.error || data.hint) ? (data.message || data.error || data.hint) : `HTTP ${res.status}`;
    const err = new Error(`Supabase ${method} ${table} failed: ${msg}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/** SELECT: query = PostgREST-Parameter, z. B. { select: '*', order: 'faellig.asc', erledigt: 'eq.false' } */
function select(table, query) {
  return request('GET', table, { query });
}

/** INSERT (Array oder Objekt), gibt die eingefügten Zeilen zurück */
function insert(table, rows) {
  return request('POST', table, { body: rows, prefer: 'return=representation' });
}

/** UPSERT über die Spalte(n) in onConflict, gibt die Zeilen zurück */
function upsert(table, rows, onConflict) {
  return request('POST', table, {
    body: rows,
    query: { on_conflict: onConflict },
    prefer: 'resolution=merge-duplicates,return=representation'
  });
}

/** UPDATE mit Filter, z. B. update('billomat_rechnungen', { erledigt: true }, { rechnungsnummer: 'eq.RE530' }) */
function update(table, patch, filter) {
  return request('PATCH', table, { body: patch, query: filter, prefer: 'return=representation' });
}

module.exports = { select, insert, upsert, update };
