/**
 * Netlify Scheduled Function: täglicher Abgleich Billomat → Supabase.
 * Zeitplan steht in netlify.toml ([functions."billomat-sync"] schedule).
 * Scheduled Functions sind nicht per HTTP erreichbar – zum manuellen Anstoßen
 * gibt es billomat-sync-now (mit Token).
 */

'use strict';

const { syncForderungen } = require('../../billomat/sync-forderungen');

exports.handler = async () => {
  const lines = [];
  const result = await syncForderungen({ log: (m) => lines.push(m) });
  console.log(`[billomat-sync] ${result.ok ? 'ok' : 'FEHLER'} offen=${result.anzahl_offen} neu=${result.neu} bezahlt=${result.bezahlt}`);
  for (const l of lines) console.log(`[billomat-sync] ${l}`);
  return { statusCode: result.ok ? 200 : 500, body: JSON.stringify(result) };
};
