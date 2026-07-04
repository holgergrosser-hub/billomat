# VS Code einrichten - Billomat

Diese Anleitung ist auf das Repository in [C:/Download/billomat](C:/Download/billomat) abgestimmt.

Wichtig: Du brauchst Visual Studio Code, nicht Visual Studio und nicht Visio.

## 1. Benötigte Programme

Installiere diese drei Programme:

1. Node.js in der LTS-Version
2. Git
3. Visual Studio Code

Empfehlung: Nutze lokal ebenfalls Node 18, weil das Repo in Netlify auf Node 18 gebaut wird.

## 2. Repository öffnen

Wenn das Repo schon auf deiner Festplatte liegt, öffne in VS Code genau diesen Ordner:

1. VS Code starten
2. Datei -> Ordner öffnen
3. Ordner [C:/Download/billomat](C:/Download/billomat) wählen

Alternativ im Terminal:

```powershell
cd C:\Download\billomat
code .
```

## 3. Projektstruktur verstehen

Für dieses Repo sind diese Pfade wichtig:

1. Frontend: [C:/Download/billomat/billomat/frontend](C:/Download/billomat/billomat/frontend)
2. Netlify Functions: [C:/Download/billomat/netlify/functions](C:/Download/billomat/netlify/functions)
3. Hauptdatei im Frontend: [C:/Download/billomat/billomat/frontend/App.jsx](C:/Download/billomat/billomat/frontend/App.jsx)

Die frühere Annahme mit [C:/Download/billomat/src/App.jsx](C:/Download/billomat/src/App.jsx) passt für dieses Repo nicht.

## 4. Frontend lokal starten

Öffne in VS Code ein Terminal und führe aus:

```powershell
cd C:\Download\billomat\billomat\frontend
npm install
npm run dev
```

Danach zeigt Vite im Terminal eine lokale Adresse an, normalerweise etwas wie `http://localhost:5173`.

## 5. Netlify Functions mittesten

Wenn du nicht nur das Frontend, sondern auch die Functions lokal testen willst, brauchst du zusätzlich Netlify CLI:

```powershell
npm install -g netlify-cli
```

Dann aus dem Repo-Root starten:

```powershell
cd C:\Download\billomat
netlify dev
```

Wichtig: `netlify dev` ist für das Zusammenspiel mit den Functions sinnvoll. Für reines Frontend reicht `npm run dev` im Ordner [C:/Download/billomat/billomat/frontend](C:/Download/billomat/billomat/frontend).

## 6. Umgebungsvariablen

Für die Billomat-Funktionen werden je nach Testfall diese Variablen verwendet:

1. `BILLOMAT_ID` oder `BILLOMAT_BASE_URL`
2. `BILLOMAT_API_KEY`
3. `BILLOMAT_ADMIN_TOKEN` für Zahlungsbuchungen

Optional:

1. `BILLOMAT_FUTURE_YEARS`
2. `BILLOMAT_MOCK=1`

Wenn lokal Fehler wie 401, 403 oder 500 auftreten, fehlt meist eine dieser Variablen.

## 7. Wichtige Dateien für den Zahlungsabgleich

Wenn du am CSV-Abgleich arbeitest, sind diese Dateien die relevanten Stellen:

1. [C:/Download/billomat/netlify/functions/billomat-invoices.js](C:/Download/billomat/netlify/functions/billomat-invoices.js)
2. [C:/Download/billomat/netlify/functions/billomat-book-payment.js](C:/Download/billomat/netlify/functions/billomat-book-payment.js)
3. [C:/Download/billomat/billomat/frontend/App.jsx](C:/Download/billomat/billomat/frontend/App.jsx)

## 8. Änderungen wieder zu GitHub hochladen

Wenn du etwas geändert hast:

```powershell
cd C:\Download\billomat
git status
git add .
git commit -m "Beschreibung der Änderung"
git push
```

## 9. Kurzfassung der Befehle

```powershell
cd C:\Download\billomat\billomat\frontend
npm install
npm run dev
```

Mit Functions:

```powershell
cd C:\Download\billomat
netlify dev
```

## 10. Häufige Fehler

1. `npm` wird nicht gefunden: Node.js fehlt oder VS Code wurde nach der Installation nicht neu gestartet.
2. `netlify` wird nicht gefunden: `npm install -g netlify-cli` ausführen.
3. Frontend startet, aber Buchungen funktionieren nicht: Umgebungsvariablen für Billomat fehlen.
4. Falscher Ordner: Für `npm run dev` musst du in [C:/Download/billomat/billomat/frontend](C:/Download/billomat/billomat/frontend) sein, nicht nur im Repo-Root.
