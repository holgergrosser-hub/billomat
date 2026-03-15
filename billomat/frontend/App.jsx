import React, { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine
} from 'recharts'

// ── Helpers ──────────────────────────────────────────────────────────────────
const MONTHS_DE = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
const STATUS_LABELS = {
  DRAFT: 'Entwurf', OPEN: 'Offen', PAID: 'Bezahlt',
  OVERDUE: 'Überfällig', CANCELLED: 'Storniert', REMINDER: 'Mahnung'
}
const STATUS_COLORS = {
  DRAFT: '#64748b', OPEN: '#818cf8', PAID: '#6ee7b7',
  OVERDUE: '#f87171', CANCELLED: '#475569', REMINDER: '#fbbf24'
}

function fmt(val) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(val || 0)
}

function getCurrentYear() { return new Date().getFullYear() }

// Fetch via Netlify Function (API key stays server-side)
async function fetchAllInvoices(setStatus) {
  setStatus('Lade Rechnungen…')
  const url = new URL('/.netlify/functions/billomat-invoices', window.location.origin)
  const res = await fetch(url)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { ok: false, error: text } }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  return data.invoices || []
}

// Build month×year matrix from invoices
function buildMatrix(invoices) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() // 0-based

  // Collect all years from invoices
  const yearSet = new Set()
  invoices.forEach(inv => {
    const invDate = inv.invoice_date || inv.date
    if (invDate) {
      const y = parseInt(String(invDate).split('-')[0], 10)
      if (y >= 2018 && y <= thisYear + 3) yearSet.add(y)
    }
  })
  // Always include current + 2 future years
  for (let y = thisYear; y <= thisYear + 2; y++) yearSet.add(y)

  const years = [...yearSet].sort()

  // Build data: { year: { month: { net, gross, count, statuses } } }
  const matrix = {}
  years.forEach(y => {
    matrix[y] = {}
    for (let m = 0; m < 12; m++) {
      matrix[y][m] = { net: 0, gross: 0, count: 0, paid: 0, open: 0, overdue: 0 }
    }
  })

  invoices.forEach(inv => {
    const invDate = inv.invoice_date || inv.date
    if (!invDate) return
    const parts = String(invDate).split('-')
    const y = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10) - 1
    if (!matrix[y] || m < 0 || m > 11) return

    const s = inv.status
    if (s === 'CANCELLED') return

    const net = parseFloat(inv.total_net || inv.net_total || 0)
    const gross = parseFloat(inv.total_gross || inv.gross_total || 0)
    matrix[y][m].net += net
    matrix[y][m].gross += gross
    matrix[y][m].count++
    if (s === 'PAID') matrix[y][m].paid += net
    else if (s === 'OPEN') matrix[y][m].open += net
    else if (s === 'OVERDUE') matrix[y][m].overdue += net
  })

  return { matrix, years, thisYear, thisMonth }
}

// Flatten matrix to chart-friendly array for a given year
function yearToChartData(matrix, year, thisYear, thisMonth) {
  return MONTHS_DE.map((label, m) => {
    const d = matrix[year]?.[m] || {}
    const isFuture = year > thisYear || (year === thisYear && m > thisMonth)
    return {
      name: label,
      netto: isFuture ? null : +(d.net || 0).toFixed(2),
      bezahlt: isFuture ? null : +(d.paid || 0).toFixed(2),
      offen: isFuture ? null : +(d.open || 0).toFixed(2),
      ueberfaellig: isFuture ? null : +(d.overdue || 0).toFixed(2),
      count: isFuture ? null : (d.count || 0),
      isFuture
    }
  })
}

// KPI summary
function buildKPIs(invoices) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth()

  let totalNet = 0, paidNet = 0, openNet = 0, overdueNet = 0
  let ytdNet = 0, mtdNet = 0
  const statusCount = {}

  invoices.forEach(inv => {
    const net = parseFloat(inv.total_net || inv.net_total || 0)
    const s = inv.status || 'UNKNOWN'
    statusCount[s] = (statusCount[s] || 0) + 1

    if (s === 'CANCELLED') return
    totalNet += net
    if (s === 'PAID') paidNet += net
    if (s === 'OPEN') openNet += net
    if (s === 'OVERDUE') overdueNet += net

    const invDate = inv.invoice_date || inv.date
    if (!invDate) return
    const parts = String(invDate).split('-')
    const y = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10) - 1
    if (y === thisYear) ytdNet += net
    if (y === thisYear && m === thisMonth) mtdNet += net
  })

  return { totalNet, paidNet, openNet, overdueNet, ytdNet, mtdNet, statusCount, count: invoices.length }
}

// ── Components ───────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = 'var(--accent)' }) {
  return (
    <div style={{
      background: 'var(--bg2)',
      border: `1px solid var(--border)`,
      borderRadius: 12,
      padding: '20px 24px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: color
      }} />
      <div style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontFamily: 'var(--font-display)', fontWeight: 700, color }}>
        {value}
      </div>
      {sub && <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg3)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 16px', fontSize: 12
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
        {label}
      </div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: 4 }}>
          {p.name}: <strong>{fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  )
}

function YearTab({ year, active, onClick, isCurrentYear }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 18px',
      borderRadius: 8,
      border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
      background: active ? 'rgba(110,231,183,0.1)' : 'var(--bg2)',
      color: active ? 'var(--accent)' : 'var(--text-dim)',
      fontWeight: active ? 700 : 400,
      fontSize: 13,
      transition: 'all .2s',
      cursor: 'pointer',
      position: 'relative'
    }}>
      {year}
      {isCurrentYear && (
        <span style={{
          position: 'absolute', top: -6, right: -6,
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)'
        }} />
      )}
    </button>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(false)
  const [selectedYear, setSelectedYear] = useState(getCurrentYear())
  const [chartType, setChartType] = useState('netto') // netto | bezahlt | offen | ueberfaellig
  const [view, setView] = useState('chart') // chart | table

  const kpis = invoices.length ? buildKPIs(invoices) : null
  const { matrix, years, thisYear, thisMonth } = invoices.length
    ? buildMatrix(invoices)
    : { matrix: {}, years: [], thisYear: getCurrentYear(), thisMonth: new Date().getMonth() }

  const chartData = years.length ? yearToChartData(matrix, selectedYear, thisYear, thisMonth) : []

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setStatus('Verbinde…')
    try {
      const data = await fetchAllInvoices(setStatus)
      setInvoices(data)
      setStatus(`${data.length} Rechnungen geladen ✓`)
      setConfigured(true)
      setSelectedYear(getCurrentYear())
    } catch (e) {
      setError(e.message)
      setStatus('')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Auto-load once. If the backend isn't configured yet, user sees the error.
    load()
  }, [load])

  // Yearly summary for the table view
  const yearlyTable = years.map(y => {
    let net = 0, paid = 0, open = 0, overdue = 0, count = 0
    for (let m = 0; m < 12; m++) {
      const d = matrix[y]?.[m] || {}
      net += d.net || 0
      paid += d.paid || 0
      open += d.open || 0
      overdue += d.overdue || 0
      count += d.count || 0
    }
    return { year: y, net, paid, open, overdue, count }
  })

  const yearSumCards = yearlyTable
    .filter(r => r.year <= thisYear)
    .slice(-6)

  const CHART_OPTIONS = [
    { key: 'netto', label: 'Nettoumsatz', color: 'var(--accent)' },
    { key: 'bezahlt', label: 'Bezahlt', color: '#6ee7b7' },
    { key: 'offen', label: 'Offen', color: 'var(--accent2)' },
    { key: 'ueberfaellig', label: 'Überfällig', color: 'var(--danger)' },
  ]

  const activeChartOpt = CHART_OPTIONS.find(o => o.key === chartType)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '0 0 60px' }}>

      {/* Header */}
      <div style={{
        padding: '28px 40px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg2)'
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22,
            letterSpacing: -0.5, color: 'var(--accent)'
          }}>
            ◈ BILLOMAT DASHBOARD
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 2, marginTop: 2 }}>
            RECHNUNGSAUSWERTUNG / NETTO
          </div>
        </div>
        {configured && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setConfigured(false); setInvoices([]) }} style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-dim)', fontSize: 12
            }}>
              ⚙ Einstellungen
            </button>
            <button onClick={load} disabled={loading} style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid var(--accent)',
              background: 'rgba(110,231,183,0.1)', color: 'var(--accent)', fontSize: 12,
              opacity: loading ? 0.5 : 1
            }}>
              ↻ Neu laden
            </button>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>

        {/* Config Panel */}
        {!configured && (
          <div style={{
            marginTop: 40,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 40, maxWidth: 520, margin: '60px auto 0'
          }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20,
              marginBottom: 8, color: 'var(--text)'
            }}>
              Billomat Dashboard
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 28 }}>
              Lädt Rechnungen über die Netlify Function <code style={{ color: 'var(--accent2)' }}>/.netlify/functions/billomat-invoices</code>.
            </div>

            {error && (
              <div style={{
                background: 'rgba(248,113,113,0.1)', border: '1px solid var(--danger)',
                borderRadius: 8, padding: '12px 16px', marginBottom: 16,
                color: 'var(--danger)', fontSize: 12
              }}>
                ✗ {error}
              </div>
            )}

            <button
              onClick={load}
              disabled={loading}
              style={{
                width: '100%', padding: '14px', borderRadius: 10,
                border: 'none', background: 'var(--accent)', color: '#0a0a0f',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
                opacity: loading ? 0.5 : 1,
                transition: 'opacity .2s'
              }}
            >
              {loading ? status : '→ Rechnungen Laden'}
            </button>

            <div style={{
              marginTop: 20, padding: '12px 16px',
              background: 'rgba(110,231,183,0.05)', borderRadius: 8,
              border: '1px solid rgba(110,231,183,0.1)',
              color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.6
            }}>
              🔒 Keine Zugangsdaten im Browser. Der API-Key liegt als Netlify Env.
              Nur GET-Anfragen – keinerlei Änderungen an deinen Daten.
            </div>
          </div>
        )}

        {/* Dashboard */}
        {configured && invoices.length > 0 && (
          <>
            {/* Status Bar */}
            {status && (
              <div style={{
                marginTop: 16, padding: '8px 16px',
                background: 'rgba(110,231,183,0.08)', borderRadius: 8,
                color: 'var(--accent)', fontSize: 12, textAlign: 'center'
              }}>
                {status}
              </div>
            )}

            {/* KPI Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16, marginTop: 32
            }}>
              <KpiCard
                label="Gesamt Netto"
                value={fmt(kpis.totalNet)}
                sub={`${kpis.count} Rechnungen gesamt`}
                color="var(--accent)"
              />
              <KpiCard
                label="Bezahlt"
                value={fmt(kpis.paidNet)}
                sub={`${kpis.statusCount?.PAID || 0} Rechnungen`}
                color="#6ee7b7"
              />
              <KpiCard
                label="Offen"
                value={fmt(kpis.openNet)}
                sub={`${kpis.statusCount?.OPEN || 0} Rechnungen`}
                color="var(--accent2)"
              />
              <KpiCard
                label="Überfällig"
                value={fmt(kpis.overdueNet)}
                sub={`${kpis.statusCount?.OVERDUE || 0} Rechnungen`}
                color="var(--danger)"
              />
              <KpiCard
                label="Dieses Jahr"
                value={fmt(kpis.ytdNet)}
                sub={`YTD ${getCurrentYear()}`}
                color="var(--warn)"
              />
              <KpiCard
                label="Dieser Monat"
                value={fmt(kpis.mtdNet)}
                sub={MONTHS_DE[new Date().getMonth()]}
                color="var(--accent3)"
              />
            </div>

            {/* View Toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 40, marginBottom: 20
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
                Monatliche Auswertung
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['chart', 'table'].map(v => (
                  <button key={v} onClick={() => setView(v)} style={{
                    padding: '6px 14px', borderRadius: 6,
                    border: view === v ? '1px solid var(--accent2)' : '1px solid var(--border)',
                    background: view === v ? 'rgba(129,140,248,0.1)' : 'transparent',
                    color: view === v ? 'var(--accent2)' : 'var(--text-muted)',
                    fontSize: 12
                  }}>
                    {v === 'chart' ? '▦ Chart' : '≡ Tabelle'}
                  </button>
                ))}
              </div>
            </div>

            {/* Year Tabs */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {years.map(y => (
                <YearTab
                  key={y}
                  year={y}
                  active={selectedYear === y}
                  onClick={() => setSelectedYear(y)}
                  isCurrentYear={y === thisYear}
                />
              ))}
            </div>

            {view === 'chart' && (
              <>
                {/* Chart Metric Selector */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                  {CHART_OPTIONS.map(opt => (
                    <button key={opt.key} onClick={() => setChartType(opt.key)} style={{
                      padding: '6px 14px', borderRadius: 6, fontSize: 12,
                      border: chartType === opt.key ? `1px solid ${opt.color}` : '1px solid var(--border)',
                      background: chartType === opt.key ? `rgba(255,255,255,0.05)` : 'transparent',
                      color: chartType === opt.key ? opt.color : 'var(--text-muted)'
                    }}>
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Bar Chart */}
                <div style={{
                  background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRadius: 16, padding: '24px 16px'
                }}>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
                    color: activeChartOpt.color, marginBottom: 20, paddingLeft: 8
                  }}>
                    {selectedYear} – {activeChartOpt.label}
                  </div>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false}
                        tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey={chartType} name={activeChartOpt.label} fill={activeChartOpt.color}
                        radius={[4, 4, 0, 0]} opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Jahresvergleich – Line Chart */}
                {years.filter(y => y <= thisYear).length > 1 && (
                  <div style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)',
                    borderRadius: 16, padding: '24px 16px', marginTop: 20
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
                      color: 'var(--text-dim)', marginBottom: 20, paddingLeft: 8
                    }}>
                      Jahresvergleich – Nettoumsatz
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="name" type="category" allowDuplicatedCategory={false}
                          tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false}
                          tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                        <Tooltip content={<CustomTooltip />} />
                        {years.filter(y => y <= thisYear).slice(-4).map((y, i) => {
                          const colors = ['#6ee7b7', '#818cf8', '#f472b6', '#fbbf24']
                          return (
                            <Line
                              key={y}
                              data={yearToChartData(matrix, y, thisYear, thisMonth).filter(d => d.netto !== null)}
                              type="monotone"
                              dataKey="netto"
                              name={String(y)}
                              stroke={colors[i % colors.length]}
                              strokeWidth={2}
                              dot={false}
                            />
                          )
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Jahressummen – Summen-Darstellung */}
                {yearSumCards.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: 16,
                      marginBottom: 12,
                      color: 'var(--text)'
                    }}>
                      Jahresvergleich – Summen (netto)
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: 12
                    }}>
                      {yearSumCards.map(row => (
                        <KpiCard
                          key={row.year}
                          label={String(row.year)}
                          value={fmt(row.net)}
                          sub={`Offen: ${fmt(row.open)} • Bezahlt: ${fmt(row.paid)} • Überfällig: ${fmt(row.overdue)} • ${row.count} Rgn.`}
                          color="var(--accent)"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {view === 'table' && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%', borderCollapse: 'collapse',
                  background: 'var(--bg2)', borderRadius: 16, overflow: 'hidden',
                  fontSize: 12
                }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '14px 16px', textAlign: 'left', color: 'var(--text-muted)', letterSpacing: 1 }}>MONAT</th>
                      <th style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--accent)' }}>NETTO</th>
                      <th style={{ padding: '14px 16px', textAlign: 'right', color: '#6ee7b7' }}>BEZAHLT</th>
                      <th style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--accent2)' }}>OFFEN</th>
                      <th style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--danger)' }}>ÜBERFÄLLIG</th>
                      <th style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>RGN.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MONTHS_DE.map((m, i) => {
                      const d = matrix[selectedYear]?.[i] || {}
                      const isFuture = selectedYear > thisYear || (selectedYear === thisYear && i > thisMonth)
                      const isCurrentMonth = selectedYear === thisYear && i === thisMonth
                      return (
                        <tr key={m} style={{
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: isCurrentMonth ? 'rgba(110,231,183,0.04)' : 'transparent',
                          opacity: isFuture ? 0.3 : 1
                        }}>
                          <td style={{ padding: '12px 16px', color: isCurrentMonth ? 'var(--accent)' : 'var(--text-dim)', fontWeight: isCurrentMonth ? 600 : 400 }}>
                            {isCurrentMonth ? '▶ ' : ''}{m} {selectedYear}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text)' }}>
                            {isFuture ? '—' : fmt(d.net)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: '#6ee7b7' }}>
                            {isFuture ? '—' : fmt(d.paid)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--accent2)' }}>
                            {isFuture ? '—' : fmt(d.open)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--danger)' }}>
                            {isFuture ? '—' : fmt(d.overdue)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>
                            {isFuture ? '—' : (d.count || 0)}
                          </td>
                        </tr>
                      )
                    })}
                    {/* Year total row */}
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg3)' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text)' }}>
                        Gesamt {selectedYear}
                      </td>
                      {['net', 'paid', 'open', 'overdue'].map(k => {
                        const total = Object.values(matrix[selectedYear] || {}).reduce((sum, d) => sum + (d[k] || 0), 0)
                        return (
                          <td key={k} style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>
                            {fmt(total)}
                          </td>
                        )
                      })}
                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>
                        {Object.values(matrix[selectedYear] || {}).reduce((sum, d) => sum + (d.count || 0), 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Jahresübersicht */}
                <div style={{ marginTop: 24 }}>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
                    marginBottom: 12, color: 'var(--text)'
                  }}>
                    Alle Jahre – Übersicht
                  </div>
                  <table style={{
                    width: '100%', borderCollapse: 'collapse',
                    background: 'var(--bg2)', borderRadius: 16, overflow: 'hidden',
                    fontSize: 12
                  }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '14px 16px', textAlign: 'left', color: 'var(--text-muted)', letterSpacing: 1 }}>JAHR</th>
                        <th style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--accent)' }}>NETTO</th>
                        <th style={{ padding: '14px 16px', textAlign: 'right', color: '#6ee7b7' }}>BEZAHLT</th>
                        <th style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--accent2)' }}>OFFEN</th>
                        <th style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--danger)' }}>ÜBERFÄLLIG</th>
                        <th style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>RGN.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearlyTable.map(row => (
                        <tr key={row.year} style={{
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: row.year === thisYear ? 'rgba(110,231,183,0.04)' : 'transparent'
                        }}>
                          <td style={{ padding: '12px 16px', color: row.year === thisYear ? 'var(--accent)' : 'var(--text-dim)', fontWeight: row.year === thisYear ? 600 : 400 }}>
                            {row.year === thisYear ? '▶ ' : ''}{row.year}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text)' }}>{fmt(row.net)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: '#6ee7b7' }}>{fmt(row.paid)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--accent2)' }}>{fmt(row.open)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--danger)' }}>{fmt(row.overdue)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
