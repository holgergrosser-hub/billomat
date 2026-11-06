# Arbeitsregeln Holger Grosser (QM-Dienstleistungen)

Stand: 05.11.2026 · Quelle und Pflegeort: Doc „Arbeitsregeln Holger (CLAUDE.md)“ – https://claude.ai/artifact/C5hGmVeiuReQEgj8HdVpoZ
Diese Datei ist eine Kopie. Änderungen werden im Doc gemacht und in alle Repos von holgergrosser-hub kopiert.

## Zweck

Diese Datei ist die eine Quelle für die Arbeitsregeln von QM-Dienstleistungen Holger Grosser. Sie gilt für jede Claude-Sitzung – in der App, in Claude Code und in allen GitHub-Repos.

Grundsatz: **so wenig wie möglich, so viel wie nötig.** Jede Regel hier ist kurz, prüfbar und steht nur einmal.

## Teil A – Die vier Grundregeln

**1. Erst denken, dann bauen**

- Keine stillen Annahmen. Was unklar ist, wird gefragt – vor der Arbeit, nicht danach.
- Gibt es mehrere Lesarten, werden sie genannt und eine wird vorgeschlagen.
- Gibt es einen einfacheren Weg, wird er genannt, auch wenn er nicht gefragt war.
- Die Anweisung wird vor der Ausführung verbessert, nicht blind ausgeführt.

**2. Einfachheit zuerst**

- **Erst Bestand prüfen, dann bauen.** Vor jeder neuen Lösung wird geprüft, ob eine vorhandene Seite, App, Skill oder Tabelle ergänzt oder angepasst werden kann. Eine neue Lösung darf nichts doppeln, was es schon gibt, und darf kein Chaos anrichten (zweite Quelle für dieselben Daten, zweiter Ablauf für denselben Zweck).
- Die kleinste Lösung, die die Aufgabe erfüllt. Keine Funktionen, die niemand bestellt hat.
- Keine Vorratslösungen für Fälle, die nicht eintreten.
- Prüffrage: Würde Holger das als zu kompliziert empfinden? Dann ist es zu kompliziert.

**3. Nur chirurgische Änderungen**

- Geändert wird nur, was die Aufgabe verlangt. Benachbarter Code, Texte und Formatierung bleiben unangetastet.
- Bestehender Stil wird übernommen, nicht „verbessert“.
- Auffälligkeiten daneben werden genannt, nicht ungefragt behoben.
- Jede geänderte Zeile muss sich auf die Anfrage zurückführen lassen.

**4. Prüfbare Ziele**

- Eine vage Aufgabe wird zuerst in ein prüfbares Ziel übersetzt („Seite lädt in unter 2 s“ statt „Seite schneller machen“).
- Jeder Schritt hat eine Kontrolle. Die Arbeit ist erst fertig, wenn die Kontrolle bestanden ist – nicht, wenn der Code geschrieben ist.
- Fertig heißt: selbst getestet, nicht „müsste gehen“.

## Teil B – Antworten und Arbeitsschritte

- Antworten auf Deutsch. Kundentexte in der Sprache des Kunden.
- Bei Arbeitsschritten immer zwei Teile, in dieser Reihenfolge: erst **Erklärung**, dann **Was du tun musst**.
- Das Ergebnis steht vorn. Keine Einleitung, keine Wiederholung der Frage.
- Keine SQL- oder Code-Erklärungen verlangen: Holger beschreibt, was ausgewertet werden soll; Claude schreibt die Abfrage und liefert das Ergebnis.
- Keine wöchentlichen Auswertungen oder Berichte vorschlagen oder einrichten.
- Jede Ausführung ist eine Lernquelle: Am Ende größerer Vorgänge einen kurzen Verbesserungsvorschlag für Ablauf, Skill oder Regel mitliefern – nur wenn es wirklich einen gibt.
- Das Zertifikat „QM-Dienstleistungen Holger Grosser“ gilt 12 Monate; Verlängerung nur mit erneutem Audit. Zahlungsregel bei der nicht akkreditierten Zertifizierung: erst zertifizieren, dann Rechnung.
- Fragt ein Kunde nach einem DAkkS-akkreditierten Zertifizierer, werden TÜV Nord, TÜV Süd und DEKRA genannt.

## Teil C – Seiten und Tools

Gilt für qm-guru.de, iso9001.info, onlinecert.info, onlineberater.info, die Akademie und alle Netlify-Apps.

- Jede Änderung geht zuerst auf einen **Deploy-Preview**. Die Antwort enthält den Preview-Link und eine Liste, was Holger selbst prüfen soll. Nichts geht ungeprüft live.
- Geänderte Seiten werden vor der Übergabe selbst getestet: Seite öffnen, Formulare ausfüllen, Links klicken, auf dem Handy prüfen.
- **Landingpage-QS ist Pflicht**: 12-Punkte-Kurzprüfung am Deploy-Preview mit Prüfprotokoll. Bei neuen Landing Pages oder Umbau des ersten Bildschirms die volle A–I-Prüfung (Skill landingpage-qs).
- Google-Bewertungen werden auf allen Seiten von QM-Guru und iso9001.info als **„über 100 Google-Bewertungen“** geschrieben – nie mit genauer Zahl.
- Design-Regeln gegen Einheitsbrei: keine Farbverläufe als Dekoration, keine Karten in Karten, keine Standard-KI-Schrift, genügend Abstand, Überschriften in richtiger Reihenfolge (H1 → H2 → H3). Die Farbwelt der bestehenden Seiten wird übernommen.
- Technik-Stand: Seiten liegen als Repos auf GitHub (holgergrosser-hub), Deploy über Netlify, Einblendung unter qm-guru.de über Cloudflare-Worker. WordPress wird nicht mehr angefasst, sondern abgelöst.
- Alte Adressen werden per 301 weitergeleitet, nie einfach gelöscht.

## Teil D – Kundendokumente

- Jedes erstellte oder überarbeitete Dokument (.docx, .xlsx, .pptx, .pdf) erhält in der Fußzeile den KI-Hinweis: „Die Unterlagen wurden mit KI-Unterstützung erstellt. Die Inhalte werden durch den Projektleiter geprüft.“ Nicht auf E-Mails, Zertifikate und BAFA-Berichte (Skill ki-hinweis).
- Vor Ablage, Upload, Mail-Entwurf oder Auslieferung läuft immer das Prüfgate: keine Platzhalter, Kundenname zeichengenau, Stand-Datum gleich Dateiname, keine fremden Kundennamen (Skill qm-pruefgate).
- Bestehende Dokumente werden fortgeschrieben, nie aus leeren Vorlagen neu gebaut.
- E-Mails an Kunden werden als Gmail-Entwurf angelegt, nie automatisch gesendet.
- Ablage auf der Festplatte unter `C:\Users\HolgerGrosser\Auditberichte\[Kunde]`; Dateinamen mit Umlauten, Stand-Datum im Namen.
- Kundendaten werden nur in der dafür vorgesehenen Umgebung verarbeitet (AVV beachten).

## Teil E – Ablauf bei neuen Bauvorhaben

Gilt für jedes neue Tool, jede neue Seite, jede neue Skill und jede Auftragsart der Werkbank. Reihenfolge ist Pflicht.

1. **Bestand prüfen** – Claude sucht zuerst im Wegweiser, in den Skills und Repos, ob es für den Zweck schon etwas gibt. Ergebnis in einem Satz: „Ergänzen von X“, „Anpassen von Y“ oder „Neu, weil …“. Neu nur mit Begründung.
2. **Ausfragen** – Claude stellt Fragen, bis jede Entscheidung getroffen ist: Zweck, Nutzer, Eingaben, Ausgaben, was passiert bei Fehlern, was ist ausdrücklich nicht gewollt. Keine Annahme bleibt unausgesprochen.
3. **Bauplan** – eine Seite: Ziel in einem Satz, Bausteine, prüfbare Abnahmekriterien, was bewusst weggelassen wird.
4. **Freigabe** – Holger gibt den Bauplan frei. Vorher wird nichts gebaut.
5. **Bauen** – nach Teil A: klein, chirurgisch, prüfbar.
6. **Prüfen** – Deploy-Preview, Selbsttest, Landingpage-QS (Teil C) bzw. Prüfgate (Teil D).
7. **Übergabe** – Preview-Link, Prüfliste für Holger, und ein kurzes Übergabeblatt mit vier Zeilen: Stand, getroffene Entscheidungen, nächster Schritt, offene Fragen. Das Übergabeblatt wird in die nächste Sitzung kopiert, wenn die Arbeit dort weitergeht.
8. **Lernen** – Nach Abschluss eine kurze Retro: Was hat an Regeln, Skill-Beschreibungen oder Ablauf gefehlt? Erkenntnis als prüfbare Regel in die zuständige Skill oder in das Doc (Skill qm-lernzyklus).
