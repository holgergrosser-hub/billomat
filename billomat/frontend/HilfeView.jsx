import React, { useState } from 'react'

// ── Hilfe / Anleitung ────────────────────────────────────────────────────────
// Wird als Overlay über dem Dashboard angezeigt. Inhalt je Rolle:
// Mahnkraft (mahn/read) sieht die Arbeitsanleitung, Admin zusätzlich den Betriebsteil.

const H = {
  mahnkraft: [
    {
      titel: '1. Anmelden und Abmelden',
      text: [
        'Adresse: https://billomat-umsatz.netlify.app/?view=forderungen – am besten als Lesezeichen speichern.',
        'Beim ersten Öffnen das Token eintragen, das du von Holger bekommen hast, und auf „Anmelden“ klicken. Der Browser merkt sich das Token; beim nächsten Mal landest du direkt in der Forderungsliste.',
        'Oben rechts steht „Abmelden (Mahnkraft)“ – damit wird das Token aus dem Browser gelöscht. Auf einem fremden oder geteilten Rechner immer abmelden.',
        'Das Token ist persönlich. Nicht weitergeben, nicht in Mails schreiben. Geht es verloren, bekommst du von Holger ein neues; das alte wird dann ungültig.'
      ]
    },
    {
      titel: '2. Die Liste lesen',
      text: [
        'Die Liste ist ein Spiegel der offenen Rechnungen aus Billomat. Sie wird jeden Morgen um 06:20 Uhr automatisch abgeglichen; bezahlte Rechnungen verschwinden von selbst. Mit „⇅ Jetzt mit Billomat abgleichen“ kannst du den Abgleich jederzeit selbst anstoßen (dauert ein paar Sekunden).',
        'Spalten: RE = Rechnungsnummer mit Rechnungs- und Fälligkeitsdatum · Kunde = Firma, Kundennummer, Ansprechpartner · Kontakt = E-Mail und Telefon/Mobil · Offen = Restbetrag (bei Teilzahlung steht der ursprüngliche Betrag darunter) · Tage = Tage seit Fälligkeit (gelb ab 5, rot ab 28) · Gesendet = höchste bereits verschickte Mahnstufe mit Datum, darunter ggf. „Entwurf“, wenn eine Mahnung vorbereitet, aber noch nicht gesendet ist · Nächste Aktion = was das System als Nächstes vorsieht · Letzte Notiz = jüngster Eintrag aus den Gesprächen.',
        '„Nächste Aktion“ bedeutet: „Zahlungserinnerung/1. Mahnung/2. Mahnung senden“ = Mahnung ist fällig, der Entwurf liegt (ab dem nächsten Morgen) im Postfach · „… abwarten“ = Mahnung ist raus, Frist läuft noch · „Entwurf … liegt bereits in Gmail“ = bitte diesen Entwurf prüfen und senden · „Nicht mahnen: …“ = Mahnsperre, Grund steht dahinter · „Entscheidung: Inkasso/Mahnbescheid oder anrufen“ = alle Mahnstufen durch, Holger entscheidet · „E-Mail-Adresse fehlt in Billomat“ = Holger muss die Adresse in Billomat nachtragen.',
        'Das Häkchen „nur überfällige“ blendet Rechnungen aus, die noch nicht fällig sind. Die Suche findet Rechnungsnummer, Kunde, Kundennummer, E-Mail und Ansprechpartner.'
      ]
    },
    {
      titel: '3. Dein Tagesablauf',
      text: [
        'Morgens: Im Postfach Mahnungen@iso9001.info liegen die vom Mahnlauf vorbereiteten Entwürfe (Betreff „Zahlungserinnerung – Rechnung RE…“, „1. Mahnung – …“, „2. Mahnung – …“). Jeden Entwurf kurz prüfen (richtiger Empfänger, Betrag stimmt mit der Liste überein) und senden. Du musst nichts eintragen – der Mahnlauf erkennt am nächsten Morgen, dass der Entwurf gesendet wurde.',
        'Dann die Liste öffnen und telefonieren, in dieser Reihenfolge: zuerst Kunden mit gebrochener Zusage (siehe Notizen), dann die mit „Entscheidung“ oder langer Überfälligkeit, zuletzt die frisch Erinnerten (frühestens 4–5 Tage nach der Zahlungserinnerung anrufen).',
        'Nach jedem Kontakt – auch nach einem erfolglosen Anrufversuch – sofort eine Notiz schreiben (Abschnitt 4) und den Kontakt erfassen (Abschnitt 6). Was nicht in der Liste steht, ist für Holger unsichtbar.',
        'Vor dem Anruf immer „▼ Details“ öffnen: Dort stehen Mahnhistorie und alle bisherigen Notizen. Wer zweimal eine Zusage gebrochen hat, bekommt keine dritte ohne konkretes Datum.'
      ]
    },
    {
      titel: '4. Notiz schreiben',
      text: [
        '„▼ Details“ öffnen, unten links „Neue Notiz“ ausfüllen, „Speichern“. Datum und dein Name (mahnkraft) werden automatisch ergänzt.',
        'In jede Notiz gehört: Wen erreicht (Name, Funktion) · Was wurde gesagt, möglichst wörtlich · Zahlung zugesagt bis (Datum) · Soll die Rechnung erneut gesendet werden, an welche Adresse · Muss Holger etwas entscheiden.',
        'Beispiel: „Fr. Zeck erreicht. Rest 1.033,83 € wird bis 30.10. überwiesen, Rechnung erneut an buchhaltung@waagen-zeck.de schicken.“ – Beispiel bei Nichterreichen: „Festnetz 2x, Mobil 1x versucht, Sprachbox, keine Nachricht hinterlassen.“',
        'Nicht in die Notiz: eigene Vermutungen oder Urteile über den Kunden. Nur was gesagt und vereinbart wurde.'
      ]
    },
    {
      titel: '5. Mahnsperre setzen oder aufheben',
      text: [
        'Eine Mahnsperre verhindert, dass der Mahnlauf die nächste Mahnung vorbereitet. Setzen, wenn: der Kunde eine Zahlung zu einem konkreten Datum zugesagt hat · eine Ratenzahlung vereinbart ist (nur Holger darf das zusagen) · der Kunde auf eine BAFA-Auszahlung wartet · der Kunde die Rechnung bestreitet (Grund „Einwand – Holger“).',
        'Im Detailbereich rechts: Grund eintragen (z. B. „Zahlung zugesagt bis 30.10.“), optional ein Datum – bis dahin gilt die Sperre, danach läuft das Mahnwesen automatisch weiter. Ohne Datum gilt die Sperre, bis sie entfernt wird. Dann „Setzen“.',
        'Aufheben: Grund-Feld leeren, Datum leeren, „Setzen“. In der Liste erscheint die Sperre unter „Nächste Aktion“ als „Nicht mahnen: …“.'
      ]
    },
    {
      titel: '6. Kontakt oder Mahnung erfassen',
      text: [
        'Im Detailbereich „Kontakt / Mahnung erfassen“: Stufe wählen (Anruf/Nachfrage, Zahlungserinnerung, 1. Mahnung, 2. Mahnung, letzte Frist), Kanal (Telefon, E-Mail, WhatsApp, Brief), Datum (vorbelegt mit heute), kurzer Vermerk, „Erfassen“. So landen auch Anrufe und selbst geschriebene Mails in der Mahnhistorie.',
        'Mahnungen, die aus den Entwürfen des Mahnlaufs gesendet wurden, musst du NICHT erfassen – die erkennt das System selbst. Erfassen nur, was du ohne Entwurf gemacht hast (Anruf, eigene Mail, Brief).',
        '„Kontakt (nur in der DB)“: Telefonnummern, Mobilnummer, Anrede und Nachname kannst du hier ergänzen – sie werden für die Liste und die Anrede in Mahnungen genutzt. Eine falsche oder fehlende E-Mail-Adresse kann nur Holger in Billomat korrigieren; dafür bitte eine Notiz „E-Mail in Billomat ändern auf …“ schreiben.'
      ]
    },
    {
      titel: '7. Mahnstufen und Fristen',
      text: [
        'Stufe 0 „Nachfrage“: freundliche Nachfrage oder Anruf, zählt nicht als Mahnung.',
        'Stufe 1 „Zahlungserinnerung“: ab 5 Tagen nach Fälligkeit, wenn noch nichts gesendet wurde.',
        'Stufe 2 „1. Mahnung“: ab 14 Tagen nach Fälligkeit und frühestens 9 Tage nach der Zahlungserinnerung, mit Frist heute + 7 Tage.',
        'Stufe 3 „2. Mahnung – letzte Zahlungsaufforderung“: ab 28 Tagen und frühestens 14 Tage nach der 1. Mahnung, mit Frist heute + 7 Tage.',
        'Stufe 4 „Letzte Frist“: nur durch Holger. 10 Tage nach der 2. Mahnung ohne Zahlung zeigt die Liste „Entscheidung: Inkasso/Mahnbescheid oder anrufen“ – ab hier keine weiteren Mails, der Fall geht an Holger.',
        'Antwortet ein Kunde auf eine Mahnung (Zahlung angekündigt, Reklamation, Ratenbitte), wird keine nächste Stufe vorbereitet, sondern der Fall als „Klären“ markiert. Dann: Notiz, ggf. Sperre, bei Einwand an Holger.'
      ]
    },
    {
      titel: '8. Regeln für jedes Gespräch',
      text: [
        'Ziel ist immer ein konkretes Zahlungsdatum oder die Auskunft, was der Zahlung im Weg steht.',
        'Keine Nachlässe, keine Ratenzahlung, keine neue Frist zusagen – das entscheidet nur Holger. Vorschläge des Kunden notieren und weitergeben.',
        'Keine Aussagen zu Verzugszinsen, Mahnverfahren, Inkasso oder rechtlichen Schritten – auch nicht, wenn danach gefragt wird.',
        'Am Telefon niemals unsere Bankverbindung nennen oder bestätigen. Will ein Kunde die IBAN „nur abgleichen“ oder behauptet, er habe schon bezahlt: nach Datum, Betrag und Empfängerkonto fragen, um einen Überweisungsbeleg per Mail bitten, Notiz schreiben, an Holger. Nennt er ein Konto, das nicht unseres ist, Gespräch freundlich beenden und Holger sofort informieren.',
        'Bestreitet ein Kunde Leistung, Stunden oder Preis: nicht diskutieren, Wortlaut notieren, Sperre „Einwand – Holger“ setzen.',
        'Immer anbieten, die Rechnung erneut per Mail zu schicken, und die richtige Rechnungsadresse erfragen – viele Verzögerungen sind nur verlorene Mails.',
        'Freundlich bleiben. Die meisten Kunden sind Stammkunden, die wiederkommen sollen.'
      ]
    },
    {
      titel: '9. Was an Holger geht',
      text: [
        'Einwände gegen Rechnung, Stunden oder Preis · Bitten um Ratenzahlung, Nachlass oder längere Frist · „schon bezahlt“ mit Bitte um IBAN-Bestätigung · Fälle mit „Entscheidung: Inkasso“ · fehlende oder falsche E-Mail-Adresse in Billomat · Fragen zu BAFA/Fördermitteln, Zertifikaten oder Audits.',
        'Weitergabe immer über eine Notiz in der Liste (Holger sieht jede Notiz) – bei dringenden Dingen zusätzlich per WhatsApp/Telefon an Holger: +49 1579 2316673.'
      ]
    },
    {
      titel: '10. Wenn etwas nicht geht',
      text: [
        '„Token ungültig“: Token noch einmal genau eintragen (keine Leerzeichen). Bleibt es dabei, hat Holger den Zugang gesperrt oder erneuert – bei ihm melden.',
        'Liste leer oder „Laden“ bringt nichts: erst „⇅ Jetzt mit Billomat abgleichen“, dann „↻ Laden“. Kommt eine rote Fehlermeldung „Server not configured“ oder „Billomat GET failed“, liegt es an der Serverseite – Holger informieren.',
        'Ein Kunde ist in der Liste, hat aber laut eigener Aussage bezahlt: Abgleich anstoßen. Ist die Rechnung in Billomat als bezahlt gebucht, verschwindet sie. Wenn nicht: Notiz mit Datum und Betrag der angeblichen Zahlung, an Holger.',
        'Die Seite sieht alt aus oder es fehlen Knöpfe: Seite neu laden (Strg+F5).'
      ]
    }
  ],
  admin: [
    {
      titel: 'A. Zugänge und Tokens (Netlify → Environment variables)',
      text: [
        'BILLOMAT_ADMIN_TOKEN: dein Zugang, komplettes Dashboard, Buchen, Erledigt-Markierung. FAELLIG_TOKEN: Lese-/Schreibzugang des automatischen Mahnlaufs. MAHN_TOKEN: Zugang der externen Mahnkraft – nur Forderungsliste, Notizen, Sperren, Kontakte.',
        'Mahnkraft sperren: Variable MAHN_TOKEN in Netlify löschen (oder Wert ändern) und einmal „Trigger deploy“. Neues Token vergeben: beliebige lange Zeichenkette, z. B. mahn_ + 32 Zeichen.',
        'Billomat-API-Key und Supabase-Service-Key liegen nur in Netlify (BILLOMAT_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Die Datenbank ist von außen ohne diesen Key nicht erreichbar (RLS aktiv).'
      ]
    },
    {
      titel: 'B. Abgleich, Mahnlauf und Datenbank',
      text: [
        'Abgleich Billomat → Datenbank: täglich 04:20 UTC (05:20/06:20 deutscher Zeit) als Netlify Scheduled Function billomat-sync; manuell per Knopf oder GET /.netlify/functions/billomat-sync-now mit Token. Er übernimmt offene Rechnungen, Kundendaten (E-Mail, Telefon aus Billomat), erkennt bezahlte/stornierte Rechnungen und deren Zahlungen und schreibt ein Protokoll (billomat_sync_log).',
        'Billomat ist Quelle für E-Mail-Adressen: eine Korrektur in der Datenbank wird beim nächsten Abgleich überschrieben – Adressen immer in Billomat ändern. Telefonnummern, die in Billomat leer sind, bleiben in der Datenbank erhalten.',
        'Mahnlauf: geplante Claude-Aufgabe „Zahlungserinnerungen (werktags)“, 06:41 Uhr. Liest die Liste, legt Gmail-Entwürfe (CC Mahnungen@iso9001.info) für fällige Stufen an, bucht sie als „Entwurf“ in die Datenbank, erkennt gesendete Entwürfe, pflegt die Tagesaktionen (re_<Nr>) und schickt dir eine Zusammenfassung. Er sendet nie selbst.',
        'Tabellen in Supabase (Projekt onlinecert): billomat_rechnungen, billomat_mahnungen, billomat_zahlungen, billomat_notizen, billomat_sync_log; Sicht billomat_offene_forderungen. Schnittstelle: /.netlify/functions/billomat-forderungen (GET mit ?format=text, ?detail=1, ?alle=1; POST für mahnung, mahnung_status, notiz, sperre, kontakt, erledigt).',
        '„Erledigt“ (Rechnung von Hand aus der Liste nehmen) gibt es nur per API mit Admin-Token – normalerweise nicht nötig, der Abgleich erledigt das, sobald Billomat die Zahlung gebucht hat.'
      ]
    },
    {
      titel: 'C. Grenzen',
      text: [
        'Die Liste kennt nur, was in Billomat als offen steht. Rechnungen, die noch nicht erstellt sind, fehlen hier (siehe Tagesaktion „Rechnung stellen“).',
        'Zahlungszusagen per WhatsApp oder Telefon stehen in keiner Mail – als Notiz oder Sperre eintragen, sonst mahnt der Mahnlauf weiter.',
        'Das Dashboard hat keine Benutzerkonten, nur Tokens. Wer ein Token kennt, hat die Rolle des Tokens. Deshalb: Admin-Token nie weitergeben, Mahn-Token bei Personalwechsel erneuern.'
      ]
    }
  ]
}

function Abschnitt({ a }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 6 }}>{a.titel}</div>
      {a.text.map((t, i) => (
        <p key={i} style={{ margin: '0 0 6px', color: 'var(--text-dim)', fontSize: 12.5, lineHeight: 1.6 }}>{t}</p>
      ))}
    </div>
  )
}

export default function HilfeView({ rolle, onClose }) {
  const [tab, setTab] = useState('mahnkraft')
  const showAdmin = rolle === 'admin'
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, maxWidth: 860, width: '100%', padding: 24, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--accent)' }}>Anleitung Forderungen und Mahnwesen</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {showAdmin && ['mahnkraft', 'admin'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12,
                border: tab === t ? '1px solid var(--accent2)' : '1px solid var(--border)',
                background: tab === t ? 'rgba(129,140,248,0.1)' : 'transparent',
                color: tab === t ? 'var(--accent2)' : 'var(--text-muted)'
              }}>{t === 'mahnkraft' ? 'Für die Mahnkraft' : 'Für Holger (Betrieb)'}</button>
            ))}
            <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', fontSize: 12 }}>✕ Schließen</button>
          </div>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 16, lineHeight: 1.6 }}>
          {tab === 'admin'
            ? 'Betriebsteil: Tokens, Abgleich, Mahnlauf, Datenbank. Stand 23.10.2026.'
            : 'Diese Anleitung beschreibt die Arbeit mit der Forderungsliste: anmelden, lesen, telefonieren, Notizen und Sperren setzen, Mahnungen versenden. Stand 23.10.2026. Bei Unklarheiten gilt: notieren und an Holger geben – nie raten.'}
        </div>
        {(tab === 'admin' ? H.admin : H.mahnkraft).map(a => <Abschnitt key={a.titel} a={a} />)}
      </div>
    </div>
  )
}
