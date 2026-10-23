import React, { useState, useEffect, useCallback } from 'react'

// ── Offene Forderungen aus der Supabase-DB (Spiegel von Billomat) ────────────
// Liest /.netlify/functions/billomat-forderungen (Token nötig) und erlaubt
// Notizen, Mahnsperren und Kontaktdaten zu pflegen sowie den Abgleich anzustoßen.

const STUFEN = { 0: '–', 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung', 4: 'Letzte Frist' }

const AKTION_STYLE = {
  mahnung: { color: 'var(--accent2)', bg: 'rgba(129,140,248,0.14)' },
  entscheidung: { color: 'var(--danger)', bg: 'rgba(248,113,113,0.14)' },
  gesperrt: { color: '#fbbf24', bg: 'rgba(251,191,36,0.14)' },
  entwurf_vorhanden: { color: '#fbbf24', bg: 'rgba(251,191,36,0.14)' },
  email_fehlt: { color: 'var(--danger)', bg: 'rgba(248,113,113,0.14)' },
  warten: { color: 'var(--text-muted)', bg: 'transparent' }
}

const PERSON = {
  anke: { label: 'Anke', color: '#fbbf24', bg: 'rgba(251,191,36,0.16)' },
  holger: { label: 'Holger', color: 'var(--danger)', bg: 'rgba(248,113,113,0.16)' },
  mahnlauf: { label: 'Mahnlauf', color: 'var(--accent2)', bg: 'rgba(129,140,248,0.16)' }
}

const KATEGORIEN = {
  A: { label: 'A – wartet auf BAFA', color: '#facc15' },
  B: { label: 'B – inhaltlicher Einwand', color: '#f87171' },
  C: { label: 'C – Rechnung nicht angekommen', color: '#fb923c' },
  D: { label: 'D – keine Reaktion', color: '#60a5fa' },
  E: { label: 'E – Lage ungeklärt', color: '#94a3b8' },
  F: { label: 'F – Aufschub zugesagt', color: '#4ade80' }
}

// Aus der Telefonmappe (Regeln für alle Gespräche)
const REGELN = [
  'VOR jedem Anruf mit Holger klären, ob es WhatsApp- oder Telefonkontakt gab – Zusagen aus diesen Kanälen stehen in keiner Mail und heben Mahnungen auf.',
  'Ziel ist immer ein konkretes Zahlungsdatum oder die Auskunft, was der Zahlung im Weg steht.',
  'Keine Nachlässe, keine Ratenzahlung, keine neue Frist zusagen – das entscheidet nur Holger.',
  'Keine Aussagen zu Verzugszinsen, Mahnverfahren, Inkasso oder rechtlichen Schritten – auch nicht auf Nachfrage.',
  'Am Telefon niemals unsere Bankverbindung nennen oder bestätigen. Will ein Kunde die IBAN bestätigt haben: notieren, an Holger.',
  'Bestreitet ein Kunde Leistung, Stunden oder Preis: freundlich beenden, Wortlaut notieren, an Holger. Nicht diskutieren.',
  'Immer anbieten, die Rechnung nochmals per Mail zu schicken, und die richtige Rechnungsadresse erfragen.',
  'Notieren, was gesagt wurde – möglichst wörtlich, nicht sinngemäß.'
]

function heuteIso() { return new Date().toISOString().slice(0, 10) }
function deDate(iso) { return iso ? String(iso).slice(0, 10).split('-').reverse().join('.') : '' }

// Hinweise-Text in Ziel / Einstieg / Achtung zerlegen
function teileHinweise(text) {
  const t = String(text || '')
  const out = {}
  const re = /(ZIEL|EINSTIEG|ACHTUNG):/g
  const idx = []
  let m
  while ((m = re.exec(t))) idx.push({ key: m[1], start: m.index, end: re.lastIndex })
  if (!idx.length) return t.trim() ? { SONST: t.trim() } : {}
  if (idx[0].start > 0) out.SONST = t.slice(0, idx[0].start).trim()
  idx.forEach((x, i) => { out[x.key] = t.slice(x.end, i + 1 < idx.length ? idx[i + 1].start : t.length).trim() })
  return out
}

function euro(val) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(val) || 0)
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg2)',
  color: 'var(--text)', fontSize: 12, outline: 'none'
}

const btnStyle = (color, bg) => ({
  padding: '6px 10px', borderRadius: 8, border: `1px solid ${color}`,
  background: bg, color, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap'
})

export default function ForderungenView({ adminToken, setAdminToken, setStatus, setError, onHilfe }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [nurUeberfaellig, setNurUeberfaellig] = useState(true)
  const [openRow, setOpenRow] = useState(null)
  const [notizText, setNotizText] = useState('')
  const [notiz, setNotiz] = useState({ erreicht: '', gesagt: '', zugesagt_bis: '', rechnung_an: '', an_holger: '' })
  const [aufgabe, setAufgabe] = useState({ zustaendig: '', wiedervorlage: '', naechster_schritt: '', kategorie: '', hinweise: '' })
  const [wer, setWer] = useState('alle') // alle | anke | holger | mahnlauf
  const [nurHeute, setNurHeute] = useState(false)
  const [regelnOffen, setRegelnOffen] = useState(false)
  const [sperreText, setSperreText] = useState('')
  const [sperreBis, setSperreBis] = useState('')
  const [kontakt, setKontakt] = useState({})
  const [erf, setErf] = useState({ stufe: '0', kanal: 'telefon', datum: new Date().toISOString().slice(0, 10), kommentar: '' })
  const [busy, setBusy] = useState(false)

  const api = useCallback(async (method, payload, query) => {
    if (!adminToken) throw new Error('Token fehlt (Admin-Token oder Lese-Token eintragen)')
    const url = new URL('/.netlify/functions/billomat-forderungen', window.location.origin)
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
      body: payload ? JSON.stringify(payload) : undefined
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body?.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    return body
  }, [adminToken])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const body = await api('GET', null, { detail: '1', alle: '1' })
      setData(prev => {
        if (!prev && body.rolle === 'mahn') setWer('anke')
        return body
      })
      setStatus(`${body.anzahl} offene Forderungen geladen ✓ (Stand ${body.stand})`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [api, setError, setStatus])

  useEffect(() => { if (adminToken) load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function syncNow() {
    setBusy(true); setError('')
    try {
      const url = new URL('/.netlify/functions/billomat-sync-now', window.location.origin)
      const res = await fetch(url, { headers: { 'x-admin-token': adminToken } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) throw new Error(body?.error || body?.fehler || `HTTP ${res.status}`)
      setStatus(`Abgleich fertig: ${body.anzahl_offen} offen, ${body.neu} neu, ${body.bezahlt} bezahlt ✓`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function akteOeffnen(rechnungsnummer, intern) {
    setError('')
    const fenster = window.open('', '_blank')
    if (fenster) fenster.document.write('<p style="font-family:Arial;padding:20px">Akte wird zusammengestellt (Rechnungen, Positionen, Zahlungen, Mahnungen, Notizen) …</p>')
    try {
      const url = new URL('/.netlify/functions/billomat-akte', window.location.origin)
      url.searchParams.set('rechnungsnummer', rechnungsnummer)
      if (intern) url.searchParams.set('intern', '1')
      const res = await fetch(url, { headers: { 'x-admin-token': adminToken } })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const html = await res.text()
      if (fenster) { fenster.document.open(); fenster.document.write(html); fenster.document.close() }
      setStatus(`Akte ${rechnungsnummer} geöffnet – dort „Drucken / als PDF speichern“ ✓`)
    } catch (e) {
      if (fenster) fenster.close()
      setError(`Akte konnte nicht erstellt werden: ${e.message}`)
    }
  }

  async function post(payload, okText) {
    setBusy(true); setError('')
    try {
      await api('POST', payload)
      setStatus(okText)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const heute = heuteIso()
  const alle = data?.rechnungen || []
  const zaehler = ['anke', 'holger', 'mahnlauf'].reduce((acc, p) => {
    const mine = alle.filter(r => r.zustaendig_effektiv === p)
    acc[p] = { gesamt: mine.length, heute: mine.filter(r => r.wiedervorlage_effektiv && r.wiedervorlage_effektiv <= heute).length }
    return acc
  }, {})
  const rows = alle.filter(r => {
    if (wer !== 'alle' && r.zustaendig_effektiv !== wer) return false
    if (nurHeute && !(r.wiedervorlage_effektiv && r.wiedervorlage_effektiv <= heute)) return false
    if (wer === 'alle' && nurUeberfaellig && Number(r.tage_ueberfaellig) < 1) return false
    if (!filter.trim()) return true
    const hay = `${r.rechnungsnummer} ${r.kunde} ${r.kundennummer || ''} ${r.email || ''} ${r.ansprechpartner || ''}`.toLowerCase()
    return hay.includes(filter.trim().toLowerCase())
  }).sort((a, b) => {
    const wa = a.wiedervorlage_effektiv || '9999-12-31'
    const wb = b.wiedervorlage_effektiv || '9999-12-31'
    if (wa !== wb) return wa < wb ? -1 : 1
    return Number(b.tage_ueberfaellig) - Number(a.tage_ueberfaellig)
  })

  const card = { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
  const th = { padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)', whiteSpace: 'nowrap' }
  const td = { padding: '10px 8px', color: 'var(--text-dim)', verticalAlign: 'top' }

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 6 }}>Offene Forderungen (Datenbank)</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.6 }}>
                Spiegel der offenen Billomat-Rechnungen in Supabase – täglich 05:20 Uhr abgeglichen, Zahlungen bucht Billomat
                über die Sparkasse-Anbindung selbst. Mahnstufen schreibt der Mahnlauf, Notizen und Sperren pflegst du hier.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={load} disabled={loading || !adminToken} style={btnStyle('var(--accent)', 'rgba(110,231,183,0.1)')}>↻ Laden</button>
              <button onClick={syncNow} disabled={busy || !adminToken} style={btnStyle('var(--accent2)', 'rgba(129,140,248,0.12)')}>{busy ? '…' : '⇅ Jetzt mit Billomat abgleichen'}</button>
              <a href="/hilfe/" target="_blank" rel="noopener" style={{ ...btnStyle('#fbbf24', 'rgba(251,191,36,0.14)'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>? Hilfe / Anleitung mit Bildern</a>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 6 }}>Suche</div>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="RE-Nummer, Kunde, E-Mail" style={inputStyle} />
            </label>
            <label style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 6 }}>Token (Admin- oder Lese-Token)</div>
              <input type="password" value={adminToken} onChange={e => setAdminToken(e.target.value)} placeholder="(Netlify Env BILLOMAT_ADMIN_TOKEN / FAELLIG_TOKEN)" style={inputStyle} />
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-end', gap: 8, fontSize: 12, color: 'var(--text-dim)', paddingBottom: 8 }}>
              <input type="checkbox" checked={nurUeberfaellig} onChange={e => setNurUeberfaellig(e.target.checked)} /> nur überfällige
            </label>
          </div>
          {data && (
            <div style={{ marginTop: 12, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12 }}>
              <span>Offen gesamt <strong style={{ color: 'var(--text)' }}>{euro(data.summe_offen)}</strong> ({data.anzahl})</span>
              <span>davon überfällig <strong style={{ color: 'var(--danger)' }}>{euro(data.summe_ueberfaellig)}</strong></span>
              <span style={{ color: 'var(--text-muted)' }}>Stand {data.stand}</span>
              <span style={{ padding: '2px 8px', borderRadius: 6, background: data.rolle === 'admin' ? 'rgba(110,231,183,0.14)' : 'rgba(251,191,36,0.14)', color: data.rolle === 'admin' ? 'var(--accent)' : '#fbbf24' }}>
                Token: {data.rolle === 'admin' ? 'Admin' : data.rolle === 'mahn' ? 'Mahnkraft' : 'Mahnlauf (Lese-Token)'}
              </span>
            </div>
          )}
          {data && (
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--text-muted)', marginRight: 4 }}>WER IST DRAN</span>
              {['alle', 'anke', 'holger', 'mahnlauf'].map(p => {
                const aktiv = wer === p
                const pc = PERSON[p] || { label: 'Alle', color: 'var(--text-dim)', bg: 'rgba(255,255,255,0.06)' }
                return (
                  <button key={p} onClick={() => setWer(p)} style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${aktiv ? pc.color : 'var(--border)'}`,
                    background: aktiv ? pc.bg : 'transparent', color: aktiv ? pc.color : 'var(--text-muted)', fontWeight: aktiv ? 700 : 400
                  }}>
                    {pc.label}{p !== 'alle' && zaehler[p] ? ` · ${zaehler[p].heute} heute / ${zaehler[p].gesamt}` : ''}
                  </button>
                )
              })}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', marginLeft: 8 }}>
                <input type="checkbox" checked={nurHeute} onChange={e => setNurHeute(e.target.checked)} /> nur heute fällig
              </label>
              <button onClick={() => setRegelnOffen(!regelnOffen)} style={{ ...btnStyle('#fbbf24', 'rgba(251,191,36,0.1)'), marginLeft: 'auto' }}>
                {regelnOffen ? '▲' : '▼'} Regeln für alle Gespräche
              </button>
            </div>
          )}
          {regelnOffen && (
            <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)', fontSize: 12, lineHeight: 1.6 }}>
              <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)' }}>
                {REGELN.map((t, i) => <li key={i} style={{ marginBottom: 3 }}>{t}</li>)}
              </ol>
              <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 11 }}>
                Kategorien: {Object.values(KATEGORIEN).map(k => <span key={k.label} style={{ color: k.color, marginRight: 12 }}>● {k.label}</span>)}
              </div>
            </div>
          )}
        </div>

        <div style={card}>
          {!adminToken ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Token eintragen, dann “Laden”.</div>
          ) : !data ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{loading ? 'Lade…' : 'Klicke “Laden”.'}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={th}>RE</th>
                    <th style={th}>Kunde</th>
                    <th style={th}>Kontakt</th>
                    <th style={{ ...th, textAlign: 'right' }}>Offen</th>
                    <th style={{ ...th, textAlign: 'right' }}>Tage</th>
                    <th style={th}>Gesendet</th>
                    <th style={th}>Wer · Wann · Was</th>
                    <th style={th}>Letzte Notiz</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const tage = Number(r.tage_ueberfaellig)
                    const st = AKTION_STYLE[r.naechste_aktion] || AKTION_STYLE.warten
                    const isOpen = openRow === r.rechnungsnummer
                    return (
                      <React.Fragment key={r.rechnungsnummer}>
                        <tr style={{ borderBottom: isOpen ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ ...td, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                            <div>{r.rechnungsnummer}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.datum_de} · fällig {r.faellig_de}</div>
                          </td>
                          <td style={td}>
                            <div style={{ color: 'var(--text)' }}>{r.kunde}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.kundennummer || ''}{r.ansprechpartner ? ` · ${r.ansprechpartner}` : ''}</div>
                          </td>
                          <td style={{ ...td, fontSize: 11 }}>
                            <div style={{ color: r.email ? 'var(--text-dim)' : 'var(--danger)' }}>{r.email || 'E-Mail fehlt'}</div>
                            <div style={{ color: 'var(--text-muted)' }}>{[r.telefon, r.mobil].filter(Boolean).join(' · ') || '—'}</div>
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                            {euro(r.offen)}
                            {r.teilbezahlt && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>von {euro(r.brutto)}</div>}
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: tage >= 28 ? 'var(--danger)' : tage >= 5 ? '#fbbf24' : 'var(--text-dim)', fontWeight: 600 }}>{tage}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            {r.gesendete_stufe ? (
                              <>
                                <div>{STUFEN[r.gesendete_stufe]}</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.gesendet_am_de} · vor {r.tage_seit_mahnung} T.</div>
                              </>
                            ) : (r.letzter_kontakt ? <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Nachfrage {r.letzter_kontakt.split('-').reverse().join('.')}</div> : '—')}
                            {r.entwurf_stufe > r.gesendete_stufe && <div style={{ color: '#fbbf24', fontSize: 11 }}>Entwurf: {STUFEN[r.entwurf_stufe]}</div>}
                          </td>
                          <td style={{ ...td, minWidth: 220 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                              {r.zustaendig_effektiv && PERSON[r.zustaendig_effektiv] && (
                                <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: PERSON[r.zustaendig_effektiv].bg, color: PERSON[r.zustaendig_effektiv].color }}>
                                  {PERSON[r.zustaendig_effektiv].label}
                                </span>
                              )}
                              {r.wiedervorlage_effektiv && (
                                <span style={{ fontSize: 11, fontWeight: 600, color: r.wiedervorlage_effektiv < heute ? 'var(--danger)' : r.wiedervorlage_effektiv === heute ? '#fbbf24' : 'var(--text-muted)' }}>
                                  {r.wiedervorlage_effektiv < heute ? `seit ${deDate(r.wiedervorlage_effektiv)}` : r.wiedervorlage_effektiv === heute ? 'heute' : `ab ${deDate(r.wiedervorlage_effektiv)}`}
                                </span>
                              )}
                              {r.kategorie && KATEGORIEN[r.kategorie] && <span title={KATEGORIEN[r.kategorie].label} style={{ fontSize: 11, color: KATEGORIEN[r.kategorie].color }}>● {r.kategorie}</span>}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.45 }}>{r.schritt_effektiv}</div>
                            {r.schritt_effektiv !== r.naechste_aktion_text && (
                              <div style={{ marginTop: 3 }}>
                                <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 5, background: st.bg, color: st.color, fontSize: 10.5 }}>{r.naechste_aktion_text}</span>
                              </div>
                            )}
                          </td>
                          <td style={{ ...td, fontSize: 11, maxWidth: 260 }}>{r.letzte_notiz || '—'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <button
                              onClick={() => {
                                setOpenRow(isOpen ? null : r.rechnungsnummer)
                                setNotizText(''); setSperreText(r.mahnsperre || ''); setSperreBis(r.mahnsperre_bis || '')
                                setNotiz({ erreicht: '', gesagt: '', zugesagt_bis: '', rechnung_an: '', an_holger: '' })
                                setAufgabe({ zustaendig: r.zustaendig || r.zustaendig_effektiv || '', wiedervorlage: r.wiedervorlage || r.wiedervorlage_effektiv || '', naechster_schritt: r.naechster_schritt || '', kategorie: r.kategorie || '', hinweise: r.hinweise || '' })
                                setKontakt({ email: r.email || '', telefon: r.telefon || '', mobil: r.mobil || '', anrede: r.anrede || '', nachname: r.nachname || '' })
                              }}
                              style={btnStyle('var(--text-dim)', 'transparent')}
                            >{isOpen ? '▲' : '▼ Details'}</button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                            <td colSpan={9} style={{ padding: '8px 12px 16px' }}>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' }}>
                                <button type="button" onClick={() => akteOeffnen(r.rechnungsnummer, false)} style={btnStyle('var(--accent2)', 'rgba(167,139,250,0.14)')}>📁 Akte für Inkasso / Mahnbescheid</button>
                                {data?.rolle === 'admin' && (
                                  <button type="button" onClick={() => akteOeffnen(r.rechnungsnummer, true)} style={btnStyle('var(--text-dim)', 'transparent')}>Akte mit internen Hinweisen</button>
                                )}
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Komplette Akte des Kunden: alle Rechnungen, Positionen, Zahlungen, Mahnungen, Kontakte, Zusagen – zum Drucken / als PDF speichern.</span>
                              </div>
                              {(() => {
                                const h = teileHinweise(r.hinweise)
                                if (!Object.keys(h).length) return null
                                const box = (titel, text, color) => text ? (
                                  <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 10.5, letterSpacing: 1.5, color, fontWeight: 700, marginBottom: 2 }}>{titel}</div>
                                    <div style={{ color: 'var(--text)', fontSize: 12.5, lineHeight: 1.55 }}>{text}</div>
                                  </div>
                                ) : null
                                return (
                                  <div style={{ margin: '4px 0 14px', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.05)' }}>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                                      <span style={{ fontWeight: 700, color: 'var(--text)' }}>Telefonblatt</span>
                                      {r.kategorie && KATEGORIEN[r.kategorie] && <span style={{ fontSize: 11, color: KATEGORIEN[r.kategorie].color }}>● {KATEGORIEN[r.kategorie].label}</span>}
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{[r.ansprechpartner, r.telefon, r.mobil].filter(Boolean).join(' · ')}</span>
                                    </div>
                                    {box('ZIEL DES ANRUFS', h.ZIEL, 'var(--accent)')}
                                    {box('MÖGLICHER EINSTIEG', h.EINSTIEG ? h.EINSTIEG : null, 'var(--accent2)')}
                                    {box('ACHTUNG', h.ACHTUNG, 'var(--danger)')}
                                    {box('HINWEIS', h.SONST, 'var(--text-muted)')}
                                  </div>
                                )
                              })()}
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, fontSize: 12 }}>
                                <div>
                                  <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>Mahnhistorie</div>
                                  {(r.mahnungen || []).length === 0 ? <div style={{ color: 'var(--text-muted)' }}>noch nichts gesendet</div> : (r.mahnungen || []).map(m => (
                                    <div key={m.id} style={{ color: 'var(--text-dim)', marginBottom: 3 }}>
                                      <span style={{ color: m.status === 'gesendet' ? 'var(--accent)' : '#fbbf24' }}>{m.status === 'gesendet' ? (m.gesendet_am ? m.gesendet_am.split('-').reverse().join('.') : '') : 'Entwurf'}</span>
                                      {' '}– Stufe {m.stufe} {STUFEN[m.stufe] !== '–' ? `(${STUFEN[m.stufe]})` : ''} · {m.kanal}{m.betreff ? ` · ${m.betreff}` : ''}{m.kommentar ? ` · ${m.kommentar}` : ''}
                                    </div>
                                  ))}
                                  <div style={{ fontWeight: 700, margin: '12px 0 6px', color: 'var(--text)' }}>Notizen</div>
                                  {(r.notizen || []).map(n => (
                                    <div key={n.id} style={{ color: 'var(--text-dim)', marginBottom: 3 }}>
                                      <span style={{ color: 'var(--text-muted)' }}>{String(n.erstellt).slice(0, 10).split('-').reverse().join('.')} {n.autor}:</span> {n.text}
                                    </div>
                                  ))}
                                  <div style={{ fontWeight: 700, margin: '12px 0 6px', color: 'var(--text)' }}>Notizen aus dem Gespräch</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 6, alignItems: 'center' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Erreicht am / mit wem</span>
                                    <input value={notiz.erreicht} onChange={e => setNotiz({ ...notiz, erreicht: e.target.value })} placeholder="z. B. Fr. Zeck (oder: nicht erreicht, 2x versucht)" style={inputStyle} />
                                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Was wurde gesagt</span>
                                    <input value={notiz.gesagt} onChange={e => setNotiz({ ...notiz, gesagt: e.target.value })} placeholder="möglichst wörtlich" style={inputStyle} />
                                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Zahlung zugesagt bis</span>
                                    <input type="date" value={notiz.zugesagt_bis} onChange={e => setNotiz({ ...notiz, zugesagt_bis: e.target.value })} style={inputStyle} />
                                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Rechnung erneut senden an</span>
                                    <input value={notiz.rechnung_an} onChange={e => setNotiz({ ...notiz, rechnung_an: e.target.value })} placeholder="E-Mail-Adresse" style={inputStyle} />
                                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>An Holger geben, weil</span>
                                    <input value={notiz.an_holger} onChange={e => setNotiz({ ...notiz, an_holger: e.target.value })} placeholder="z. B. bestreitet Stunden, will Ratenzahlung" style={inputStyle} />
                                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Sonstiges</span>
                                    <input value={notizText} onChange={e => setNotizText(e.target.value)} placeholder="freier Text" style={inputStyle} />
                                  </div>
                                  <div style={{ color: 'var(--text-muted)', fontSize: 10.5, margin: '6px 0' }}>
                                    Zahlungszusage → Sperre bis zum Datum, Wiedervorlage am Folgetag (Anke). „An Holger“ → Holger ist dran, heute.
                                  </div>
                                  <button
                                    disabled={busy || !(notiz.erreicht || notiz.gesagt || notiz.zugesagt_bis || notiz.rechnung_an || notiz.an_holger || notizText.trim())}
                                    onClick={() => { post({ aktion: 'notiz', rechnungsnummer: r.rechnungsnummer, ...notiz, text: notizText.trim() }, 'Notiz gespeichert ✓'); setNotiz({ erreicht: '', gesagt: '', zugesagt_bis: '', rechnung_an: '', an_holger: '' }); setNotizText('') }}
                                    style={{ ...btnStyle('var(--accent)', 'rgba(110,231,183,0.1)'), width: '100%' }}
                                  >Notiz speichern</button>
                                </div>
                                <div>
                                  <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>Nächste Aktion festlegen</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <select value={aufgabe.zustaendig} onChange={e => setAufgabe({ ...aufgabe, zustaendig: e.target.value })} style={inputStyle}>
                                      <option value="">Wer? (automatisch)</option>
                                      <option value="anke">Anke</option>
                                      <option value="holger">Holger</option>
                                      <option value="mahnlauf">Mahnlauf</option>
                                    </select>
                                    <input type="date" value={aufgabe.wiedervorlage} onChange={e => setAufgabe({ ...aufgabe, wiedervorlage: e.target.value })} title="Wann ist die nächste Aktion fällig?" style={inputStyle} />
                                    <input value={aufgabe.naechster_schritt} onChange={e => setAufgabe({ ...aufgabe, naechster_schritt: e.target.value })} placeholder="Was ist zu tun? (z. B. erneut anrufen, Beleg prüfen)" style={{ ...inputStyle, gridColumn: '1 / -1' }} />
                                    <select value={aufgabe.kategorie} onChange={e => setAufgabe({ ...aufgabe, kategorie: e.target.value })} style={inputStyle}>
                                      <option value="">Kategorie –</option>
                                      {Object.entries(KATEGORIEN).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select>
                                    <button disabled={busy} onClick={() => post({ aktion: 'aufgabe', rechnungsnummer: r.rechnungsnummer, zustaendig: aufgabe.zustaendig || null, wiedervorlage: aufgabe.wiedervorlage || null, naechster_schritt: aufgabe.naechster_schritt || null, kategorie: aufgabe.kategorie || null }, 'Nächste Aktion gespeichert ✓')} style={btnStyle('var(--accent2)', 'rgba(129,140,248,0.12)')}>Speichern</button>
                                    {data?.rolle === 'admin' && (
                                      <>
                                        <textarea value={aufgabe.hinweise} onChange={e => setAufgabe({ ...aufgabe, hinweise: e.target.value })} placeholder="Telefonblatt: ZIEL: … EINSTIEG: … ACHTUNG: …" rows={4} style={{ ...inputStyle, gridColumn: '1 / -1', resize: 'vertical', fontFamily: 'inherit' }} />
                                        <button disabled={busy} onClick={() => post({ aktion: 'aufgabe', rechnungsnummer: r.rechnungsnummer, hinweise: aufgabe.hinweise || null }, 'Telefonblatt gespeichert ✓')} style={{ ...btnStyle('#fbbf24', 'rgba(251,191,36,0.14)'), gridColumn: '1 / -1' }}>Telefonblatt speichern (nur Admin)</button>
                                      </>
                                    )}
                                  </div>
                                  <div style={{ fontWeight: 700, margin: '12px 0 6px', color: 'var(--text)' }}>Mahnsperre</div>
                                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 }}>Solange ein Text eingetragen ist, legt der Mahnlauf keinen Entwurf an (z. B. „Ratenzahlung“, „wartet auf BAFA“, „Einwand – Holger“).</div>
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <input value={sperreText} onChange={e => setSperreText(e.target.value)} placeholder="Grund (leer = keine Sperre)" style={{ ...inputStyle, flex: 2, minWidth: 160 }} />
                                    <input type="date" value={sperreBis} onChange={e => setSperreBis(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
                                    <button disabled={busy} onClick={() => post({ aktion: 'sperre', rechnungsnummer: r.rechnungsnummer, mahnsperre: sperreText.trim() || null, mahnsperre_bis: sperreBis || null }, 'Sperre gespeichert ✓')} style={btnStyle('#fbbf24', 'rgba(251,191,36,0.14)')}>Setzen</button>
                                  </div>
                                  <div style={{ fontWeight: 700, margin: '12px 0 6px', color: 'var(--text)' }}>Kontakt (nur in der DB, nicht in Billomat)</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <input value={kontakt.email} onChange={e => setKontakt({ ...kontakt, email: e.target.value })} placeholder="E-Mail" style={inputStyle} />
                                    <input value={kontakt.telefon} onChange={e => setKontakt({ ...kontakt, telefon: e.target.value })} placeholder="Telefon" style={inputStyle} />
                                    <input value={kontakt.mobil} onChange={e => setKontakt({ ...kontakt, mobil: e.target.value })} placeholder="Mobil" style={inputStyle} />
                                    <input value={kontakt.anrede} onChange={e => setKontakt({ ...kontakt, anrede: e.target.value })} placeholder="Anrede (Herr/Frau)" style={inputStyle} />
                                    <input value={kontakt.nachname} onChange={e => setKontakt({ ...kontakt, nachname: e.target.value })} placeholder="Nachname" style={inputStyle} />
                                    <button disabled={busy} onClick={() => post({ aktion: 'kontakt', rechnungsnummer: r.rechnungsnummer, ...kontakt }, 'Kontakt gespeichert ✓')} style={btnStyle('var(--accent)', 'rgba(110,231,183,0.1)')}>Kontakt speichern</button>
                                  </div>
                                  <div style={{ fontWeight: 700, margin: '12px 0 6px', color: 'var(--text)' }}>Kontakt / Mahnung erfassen</div>
                                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 }}>Für Anrufe, eigene Mails oder Briefe. Entwürfe des Mahnlaufs, die du nur sendest, musst du nicht erfassen.</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <select value={erf.stufe} onChange={e => setErf({ ...erf, stufe: e.target.value })} style={inputStyle}>
                                      <option value="0">Anruf / Nachfrage (Stufe 0)</option>
                                      <option value="1">Zahlungserinnerung (Stufe 1)</option>
                                      <option value="2">1. Mahnung (Stufe 2)</option>
                                      <option value="3">2. Mahnung (Stufe 3)</option>
                                      <option value="4">Letzte Frist (Stufe 4)</option>
                                    </select>
                                    <select value={erf.kanal} onChange={e => setErf({ ...erf, kanal: e.target.value })} style={inputStyle}>
                                      <option value="telefon">Telefon</option>
                                      <option value="gmail">E-Mail</option>
                                      <option value="whatsapp">WhatsApp</option>
                                      <option value="brief">Brief</option>
                                    </select>
                                    <input type="date" value={erf.datum} onChange={e => setErf({ ...erf, datum: e.target.value })} style={inputStyle} />
                                    <input value={erf.kommentar} onChange={e => setErf({ ...erf, kommentar: e.target.value })} placeholder="Vermerk (z. B. Fr. Zeck erreicht, zahlt bis 30.10.)" style={inputStyle} />
                                    <button disabled={busy || !erf.datum} onClick={() => post({ aktion: 'mahnung', rechnungsnummer: r.rechnungsnummer, stufe: Number(erf.stufe), status: 'gesendet', gesendet_am: erf.datum, kanal: erf.kanal, kommentar: erf.kommentar.trim() || null, betreff: erf.stufe === '0' ? 'Kontakt' : undefined }, 'Erfasst ✓')} style={{ ...btnStyle('var(--accent2)', 'rgba(129,140,248,0.12)'), gridColumn: '1 / -1' }}>Erfassen</button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={9} style={{ padding: 16, color: 'var(--text-muted)' }}>Keine Rechnungen für diesen Filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {data?.erledigt?.length > 0 && (
          <div style={card}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 8 }}>Zuletzt bezahlt / erledigt (60 Tage)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={th}>RE</th><th style={th}>Kunde</th><th style={{ ...th, textAlign: 'right' }}>Brutto</th><th style={th}>Status</th><th style={th}>Bezahlt am</th>
                </tr>
              </thead>
              <tbody>
                {data.erledigt.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ ...td, color: 'var(--text)' }}>{r.rechnungsnummer}</td>
                    <td style={td}>{r.kunde}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{euro(r.brutto)}</td>
                    <td style={{ ...td, color: r.status === 'PAID' ? 'var(--accent)' : 'var(--text-muted)' }}>{r.status}</td>
                    <td style={td}>{r.bezahlt_am_de || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
