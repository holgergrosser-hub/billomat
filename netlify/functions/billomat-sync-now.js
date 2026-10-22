/**
 * Netlify Function: Abgleich Billomat → Supabase sofort ausführen.
 *   GET /.netlify/functions/billomat-sync-now
 *   Header x-admin-token: <BILLOMAT_ADMIN_TOKEN | FAELLIG_TOKEN>  (oder ?token=…)
 */

'use strict';

const { authorize } = require('../../billomat/auth');
const { syncForderungen } = require('../../billomat/sync-forderungen');

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }
  if (!authorize(event)) return json(401, { ok: false, error: 'Unauthorized' });

  const lines = [];
  const result = await syncForderungen({ log: (m) => lines.push(m) });
  return json(result.ok ? 200 : 502, { ...result, protokoll: lines });
};
