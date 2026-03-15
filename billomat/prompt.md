# Prompt-Vorlage: Rechnungslage (Billomat)

Ziel: Ich will jederzeit sehen, **wo ich mit den Rechnungen stehe**: offen, bezahlt, überfällig – und wie sich das netto pro Monat/Jahr entwickelt.

## Datenquelle

Netlify Endpoint: `/.netlify/functions/billomat-invoices`

Die Antwort liefert:
- `summary.byMonth`: pro Monat `netTotal`, `openNetTotal`, `paidNetTotal`, `count`, `statusCounts`
- `summary.byYear`: dieselben Kennzahlen pro Jahr

## Prompt (für Agent / Auswertung)

Analysiere die Billomat-Rechnungen anhand der gelieferten JSON-Daten.

1) Status-Überblick:
- Wie viele Rechnungen sind OPEN/PAID/OVERDUE (falls vorhanden)?
- Wie hoch ist die offene Summe **netto** insgesamt?

2) Monatsverlauf (netto):
- Gib eine Tabelle mit Monat → `netTotal`, `openNetTotal`, `paidNetTotal`, `count`.
- Markiere die 3 stärksten Monate (höchstes `netTotal`) und 3 schwächsten.

3) Jahresvergleich:
- Vergleiche die Jahre nach `netTotal` und `openNetTotal`.
- Nenne Trend (steigend/fallend) und mögliche Auffälligkeiten.

4) Handlungsliste:
- Falls `openNetTotal` hoch ist: priorisiere Mahn-/Nachfass-Aktionen (z.B. nach ältesten Fälligkeiten, wenn `due_date` vorhanden ist).

Randbedingungen:
- Werte immer **netto** aus.
- Leere Monate (0) sollen sichtbar bleiben, damit Zukunftsjahre automatisch „mitlaufen“.
