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
      setData(body)
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

  const rows = (data?.rechnungen || []).filter(r => {
    if (nurUeberfaellig && Number(r.tage_ueberfaellig) < 1) return false
    if (!filter.trim()) return true
    const hay = `${r.rechnungsnummer} ${r.kunde} ${r.kundennummer || ''} ${r.email || ''} ${r.ansprechpartner || ''}`.toLowerCase()
    return hay.includes(filter.trim().toLowerCase())
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
              {onHilfe && <button onClick={onHilfe} style={btnStyle('#fbbf24', 'rgba(251,191,36,0.14)')}>? Hilfe / Anleitung</button>}
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
                    <th style={th}>Nächste Aktion</th>
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
                          <td style={td}>
                            <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 6, background: st.bg, color: st.color, fontSize: 11 }}>
                              {r.naechste_aktion_text}
                            </span>
                          </td>
                          <td style={{ ...td, fontSize: 11, maxWidth: 260 }}>{r.letzte_notiz || '—'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <button
                              onClick={() => {
                                setOpenRow(isOpen ? null : r.rechnungsnummer)
                                setNotizText(''); setSperreText(r.mahnsperre || ''); setSperreBis(r.mahnsperre_bis || '')
                                setKontakt({ email: r.email || '', telefon: r.telefon || '', mobil: r.mobil || '', anrede: r.anrede || '', nachname: r.nachname || '' })
                              }}
                              style={btnStyle('var(--text-dim)', 'transparent')}
                            >{isOpen ? '▲' : '▼ Details'}</button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                            <td colSpan={9} style={{ padding: '8px 12px 16px' }}>
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
                                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <input value={notizText} onChange={e => setNotizText(e.target.value)} placeholder="Neue Notiz" style={inputStyle} />
                                    <button disabled={busy || !notizText.trim()} onClick={() => post({ aktion: 'notiz', rechnungsnummer: r.rechnungsnummer, text: notizText.trim() }, 'Notiz gespeichert ✓')} style={btnStyle('var(--accent)', 'rgba(110,231,183,0.1)')}>Speichern</button>
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>Mahnsperre</div>
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
