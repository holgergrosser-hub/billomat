/**
 * Netlify Function: proxy to Google Apps Script web app.
 *
 * Env vars required in Netlify:
 * - APPS_SCRIPT_URL: Web App URL (ends with /exec)
 * - APPS_SCRIPT_TOKEN: shared secret (same as Apps Script Script Property API_TOKEN)
 */

exports.handler = async (event) => {
  const headers = {
    'content-type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: 'Method not allowed' })
    };
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  const token = process.env.APPS_SCRIPT_TOKEN;

  if (!appsScriptUrl || !token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: 'Server not configured: missing APPS_SCRIPT_URL/APPS_SCRIPT_TOKEN' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: 'Invalid JSON body' })
    };
  }

  const folderId = String(payload.folderId || '').trim();
  const logoDataUrl = String(payload.logoDataUrl || '').trim();
  const placeholder = String(payload.placeholder || '{{LOGO_URL}}').trim() || '{{LOGO_URL}}';

  if (!folderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'folderId missing' }) };
  }
  if (!logoDataUrl || !logoDataUrl.startsWith('data:')) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'logoDataUrl missing/invalid' }) };
  }

  const upstreamBody = {
    token,
    action: 'insertLogoInFolderDocs',
    folderId,
    placeholder,
    logoDataUrl
  };

  try {
    const upstreamRes = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(upstreamBody)
    });

    const text = await upstreamRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text || `HTTP ${upstreamRes.status}` }; }

    if (!upstreamRes.ok || !data.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ ok: false, error: data.error || `Upstream error HTTP ${upstreamRes.status}` })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: `Proxy error: ${e.message}` })
    };
  }
};
