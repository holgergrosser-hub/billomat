# Billomat (Netlify)

Dieses Verzeichnis enthält die Billomat-Integration (GET-only) + Monats-/Jahresauswertung.

## Netlify Env Vars

- `BILLOMAT_ID` (z.B. `meinefirma`) **oder** `BILLOMAT_BASE_URL` (z.B. `https://meinefirma.billomat.net`)
- `BILLOMAT_API_KEY`

Optional:
- `BILLOMAT_MOCK=1` → liefert Beispiel-Rechnungen aus `billomat/mock-invoices.json`
- `BILLOMAT_FUTURE_YEARS=2` → ergänzt leere Monate bis `currentYear + 2`

## Endpoint

Netlify Function: `/.netlify/functions/billomat-invoices`

Query-Parameter (optional):
- `status=OPEN`
- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`

Antwort enthält:
- `invoices`: Liste der Rechnungen
- `summary.byMonth`: Monatswerte (inkl. leere Monate)
- `summary.byYear`: Jahresaggregation

## Lokal testen (Mock)

In Netlify oder lokal per Node:
- Env setzen: `BILLOMAT_MOCK=1`
- Dann Function aufrufen (z.B. über Netlify Dev) oder in einem kleinen Test-Event.
