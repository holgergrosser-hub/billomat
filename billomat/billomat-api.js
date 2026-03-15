'use strict';

function getEnv(name) {
  const value = process.env[name];
  return value == null ? '' : String(value);
}

function buildBaseUrl() {
  const explicit = getEnv('BILLOMAT_BASE_URL').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const billomatId = getEnv('BILLOMAT_ID').trim();
  if (!billomatId) return '';
  return `https://${billomatId}.billomat.net`;
}

function jsonHeaders(apiKey) {
  return {
    'Accept': 'application/json',
    'X-BillomatApiKey': apiKey
  };
}

function toUrl(baseUrl, path, query) {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function billomatGetJson({ path, query }) {
  const baseUrl = buildBaseUrl();
  const apiKey = getEnv('BILLOMAT_API_KEY').trim();

  if (!baseUrl) {
    throw new Error('Missing BILLOMAT_BASE_URL or BILLOMAT_ID');
  }
  if (!apiKey) {
    throw new Error('Missing BILLOMAT_API_KEY');
  }

  const url = toUrl(baseUrl, path, query);

  const res = await fetch(url, {
    method: 'GET',
    headers: jsonHeaders(apiKey)
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) ? (data.error || data.message) : `HTTP ${res.status}`;
    const err = new Error(`Billomat GET failed: ${msg}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

module.exports = {
  buildBaseUrl,
  billomatGetJson
};
