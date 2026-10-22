# Billomat – Netlify Dashboard

Minimaler Netlify-Deploy für:
- Billomat Rechnungen per **GET** via Netlify Function (API-Key bleibt serverseitig)
- Monats-/Jahres-Auswertung (netto) inkl. automatisch ergänzter Zukunftsjahre
- Optionales React/Vite Frontend Dashboard

## Deploy (Netlify)

### Env Vars
- `BILLOMAT_ID` (z.B. `meinefirma`) **oder** `BILLOMAT_BASE_URL` (z.B. `https://meinefirma.billomat.net`)
- `BILLOMAT_API_KEY`

Für Buchungen (write):
- `BILLOMAT_ADMIN_TOKEN` (Shared Secret, nur für Mitarbeiter-UI „Zahlung buchen“)

Optional:
- `BILLOMAT_FUTURE_YEARS=2`
- `BILLOMAT_MOCK=1`

### Endpoint
- `/.netlify/functions/billomat-invoices` – seit 23.10.2026 nur mit Admin-Token (Header `x-admin-token` oder `?token=`), weil die Antwort alle Rechnungen enthält

Payment buchen:
- `/.netlify/functions/billomat-book-payment` (POST, Header `x-admin-token`)

Antwort:
- `invoices`: Rechnungen
- `summary.byMonth`: Monatsauswertung (netto)
- `summary.byYear`: Jahresauswertung

## Lokal
- Frontend: `cd billomat/frontend; npm install; npm run dev`
- Function (Mock): `BILLOMAT_MOCK=1` und dann über Netlify Dev oder direkt per Node testen.

## Fälligkeitsliste (Zahlungserinnerungen)
- `/.netlify/functions/billomat-faellig` (GET, Header `x-admin-token` oder `?token=`; gültig sind `BILLOMAT_ADMIN_TOKEN` und der Lese-Token `FAELLIG_TOKEN`)
- Liefert offene/überfällige Rechnungen mit Kunde, E-Mail, Fälligkeit, Tagen überfällig und Mahnstufen-Vorschlag (5/14/28 Tage)
- `?format=text` für eine kompakte Textliste
- Datenquelle der geplanten Claude-Aufgabe „Zahlungserinnerungen" (Gmail-Entwürfe, Tagesaktionen)

## Forderungs-Datenbank (Supabase) – Spiegel der offenen Rechnungen
Billomat gleicht die Sparkasse-Eingänge selbst ab. Die Supabase-Tabellen `billomat_*` (Projekt `onlinecert`)
spiegeln täglich die offenen Rechnungen und halten Mahnstand, Zahlungen, Notizen und Mahnsperren.

Env Vars (Netlify): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (nur serverseitig; RLS ist aktiv, anon hat keinen Zugriff).
Tokens: `BILLOMAT_ADMIN_TOKEN` (alles), `FAELLIG_TOKEN` (Mahnlauf), `MAHN_TOKEN` (externe Mahnkraft – eigener Token, zum Sperren einfach die Variable löschen).
Direktlink für die Mahnkraft: `https://billomat-umsatz.netlify.app/?view=forderungen`
Das Dashboard verlangt beim Öffnen ein Token: Admin-Token → komplettes Dashboard, Mahn-/Lese-Token → ausschließlich die Forderungsliste (keine Umsätze, keine KPIs).

- `/.netlify/functions/billomat-sync` – Scheduled Function, täglich 04:20 UTC (`netlify.toml`); nicht per HTTP erreichbar
- `/.netlify/functions/billomat-sync-now` – Abgleich sofort (GET, Header `x-admin-token`: Admin- oder `FAELLIG_TOKEN`)
- `/.netlify/functions/billomat-forderungen` – GET Liste inkl. Mahnstand und Vorschlag für die nächste Stufe (`?format=text`, `?detail=1`, `?alle=1`);
  POST `{aktion: 'mahnung'|'mahnung_status'|'notiz'|'sperre'|'kontakt'|'erledigt', …}` (Token wie oben, `erledigt` nur Admin)
- Dashboard-Reiter „Forderungen“ liest diese Funktion; der frühere CSV-Buchen-Bereich ist entfallen

Tabellen: `billomat_rechnungen`, `billomat_mahnungen` (Stufe 0 Nachfrage, 1 Zahlungserinnerung, 2 1. Mahnung, 3 2. Mahnung, 4 letzte Frist),
`billomat_zahlungen`, `billomat_notizen`, `billomat_sync_log`; Sicht `billomat_offene_forderungen`.
Der tägliche Mahnlauf (geplante Claude-Aufgabe) liest die Liste von hier und meldet Entwürfe/gesendete Stufen per POST zurück.

## Proxy für Google Apps Script
- `/billomat-api/*` → Billomat-API (Header `x-admin-token`), siehe `netlify/functions/billomat-proxy.js`
