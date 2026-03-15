# Billomat – Netlify Dashboard

Minimaler Netlify-Deploy für:
- Billomat Rechnungen per **GET** via Netlify Function (API-Key bleibt serverseitig)
- Monats-/Jahres-Auswertung (netto) inkl. automatisch ergänzter Zukunftsjahre
- Optionales React/Vite Frontend Dashboard

## Deploy (Netlify)

### Env Vars
- `BILLOMAT_ID` (z.B. `meinefirma`) **oder** `BILLOMAT_BASE_URL` (z.B. `https://meinefirma.billomat.net`)
- `BILLOMAT_API_KEY`

Optional:
- `BILLOMAT_FUTURE_YEARS=2`
- `BILLOMAT_MOCK=1`

### Endpoint
- `/.netlify/functions/billomat-invoices`

Antwort:
- `invoices`: Rechnungen
- `summary.byMonth`: Monatsauswertung (netto)
- `summary.byYear`: Jahresauswertung

## Lokal
- Frontend: `cd billomat/frontend; npm install; npm run dev`
- Function (Mock): `BILLOMAT_MOCK=1` und dann über Netlify Dev oder direkt per Node testen.
