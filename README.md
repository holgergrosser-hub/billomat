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
- `/.netlify/functions/billomat-invoices`

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

## Proxy für Google Apps Script
- `/billomat-api/*` → Billomat-API (Header `x-admin-token`), siehe `netlify/functions/billomat-proxy.js`
