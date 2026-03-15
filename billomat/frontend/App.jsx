import React, { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, LabelList
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

function fmtInt(val) {
  if (val === null || val === undefined) return ''
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(val || 0)
}

function parseGermanNumber(v) {
  if (v == null) return 0
  const s = String(v).trim()
  if (!s) return 0
  const normalized = s
    .replace(/\./g, '')
    .replace(/\s/g, '')
    .replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

function toIsoDateFromSparkasse(value) {
  const s = String(value || '').trim()
  if (!s) return ''

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // DD.MM.YYYY
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (m) {
    const [, dd, mm, yyyy] = m
    return `${yyyy}-${mm}-${dd}`
  }

  // DD.MM.YY (Sparkasse often uses 2-digit year)
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/)
  if (m) {
    const [, dd, mm, yy] = m
    const y = Number(yy)
    const yyyy = (y <= 69 ? 2000 + y : 1900 + y)
    return `${yyyy}-${mm}-${dd}`
  }

  return ''
}

function detectDelimiter(line) {
  const semi = (line.match(/;/g) || []).length
  const comma = (line.match(/,/g) || []).length
  const tab = (line.match(/\t/g) || []).length
  if (tab >= semi && tab >= comma) return '\t'
  if (semi >= comma) return ';'
  return ','
}

function parseCsv(text) {
  const rows = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(r => r.trim().length > 0)

  if (!rows.length) return []
  const delim = detectDelimiter(rows[0])

  // Simple CSV split (Sparkasse exports are usually simple, no multiline fields)
  const splitRow = (row) => {
    const out = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch === '"') {
        if (inQuotes && row[i + 1] === '"') { cur += '"'; i++; continue }
        inQuotes = !inQuotes
        continue
      }
      if (!inQuotes && ch === delim) {
        out.push(cur)
        cur = ''
        continue
      }
      cur += ch
    }
    out.push(cur)
    return out.map(x => x.trim())
  }

  const header = splitRow(rows[0]).map(h => h.toLowerCase())
  const dataRows = rows.slice(1).map(splitRow)

  const idx = (names) => header.findIndex(h => names.some(n => h.includes(n)))
  const dateIdx = idx(['buchungstag', 'buchungsdatum', 'date'])
  const valutaIdx = idx(['valuta'])
  const amountIdx = idx(['betrag', 'amount'])
  const purposeIdx = idx(['verwendungszweck', 'zweck', 'purpose'])
  const nameIdx = idx(['begünstigter', 'beguenstigter', 'zahlungspflichtiger', 'auftraggeber', 'name'])
  const ibanIdx = idx(['iban'])

  const tx = []
  for (const r of dataRows) {
    const bookingDateRaw = (r[dateIdx] || '').trim()
    const valutaDateRaw = (r[valutaIdx] || '').trim()
    const dateIso = toIsoDateFromSparkasse(valutaDateRaw) || toIsoDateFromSparkasse(bookingDateRaw)
    const amount = parseGermanNumber(r[amountIdx])
    const purpose = (r[purposeIdx] || '').trim()
    const name = (r[nameIdx] || '').trim()
    const iban = (r[ibanIdx] || '').trim()
    if (!amount) continue
    tx.push({
      id: `${dateIso || bookingDateRaw || valutaDateRaw}|${amount}|${purpose}`.slice(0, 140),
      dateIso,
      bookingDateRaw,
      valutaDateRaw,
      amount,
      purpose,
      name,
      iban
    })
  }
  return tx
}

function isoDateToday() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function normalizeInvoiceNumber(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '')
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

function yearToCumulativeYoYData(matrix, year, thisYear, thisMonth) {
  let cum = 0
  let prevCum = 0

  return MONTHS_DE.map((label, m) => {
    const d = matrix[year]?.[m] || {}
    const prev = matrix[year - 1]?.[m] || {}
    cum += d.net || 0
    prevCum += prev.net || 0

    const isFuture = year > thisYear || (year === thisYear && m > thisMonth)
    return {
      name: `${label}. ${year}`,
      jahr: isFuture ? null : Math.round(cum),
      vorjahr: Math.round(prevCum)
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

function CumulativeTooltip({ active, payload, label }) {
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
          {p.name}: <strong>{fmtInt(p.value)}</strong>
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
  const [view, setView] = useState('chart') // chart | table | reconcile

  // Reconcile state
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('bm_admin_token') || '')
  const [transactions, setTransactions] = useState([])
  const [openInvoices, setOpenInvoices] = useState([])
  const [txQuery, setTxQuery] = useState('')
  const [matchByInvoiceId, setMatchByInvoiceId] = useState({})
  const [payDateByInvoiceId, setPayDateByInvoiceId] = useState({})
  const [bookingBusyId, setBookingBusyId] = useState(null)

  const kpis = invoices.length ? buildKPIs(invoices) : null
  const { matrix, years, thisYear, thisMonth } = invoices.length
    ? buildMatrix(invoices)
    : { matrix: {}, years: [], thisYear: getCurrentYear(), thisMonth: new Date().getMonth() }

  const chartData = years.length ? yearToChartData(matrix, selectedYear, thisYear, thisMonth) : []
  const cumulativeYoYData = years.length ? yearToCumulativeYoYData(matrix, selectedYear, thisYear, thisMonth) : []

  async function fetchOpenInvoices() {
    const base = new URL('/.netlify/functions/billomat-invoices', window.location.origin)

    const fetchStatus = async (st) => {
      const url = new URL(base)
      url.searchParams.set('status', st)
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      return Array.isArray(data.invoices) ? data.invoices : []
    }

    // OPEN + OVERDUE
    const [open, overdue] = await Promise.all([
      fetchStatus('OPEN'),
      fetchStatus('OVERDUE')
    ])
    const merged = [...open, ...overdue]

    // De-duplicate by id
    const map = new Map()
    for (const inv of merged) {
      const id = String(inv.id || '')
      if (!id) continue
      map.set(id, inv)
    }
    return Array.from(map.values())
  }

  async function bookPayment({ invoice, tx, payDate }) {
    const url = new URL('/.netlify/functions/billomat-book-payment', window.location.origin)
    const amount = Math.abs(Number(tx.amount))
    const body = {
      invoiceId: Number(invoice.id),
      date: payDate,
      amount,
      comment: `Sparkasse: ${tx.purpose || ''}`.slice(0, 180),
      type: 'BANK_TRANSFER',
      markInvoiceAsPaid: true
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`)
    }
    return data
  }

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

  useEffect(() => {
    localStorage.setItem('bm_admin_token', adminToken)
  }, [adminToken])

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
                {view === 'reconcile' ? 'Zahlungen buchen' : 'Monatliche Auswertung'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['chart', 'table', 'reconcile'].map(v => (
                  <button key={v} onClick={() => setView(v)} style={{
                    padding: '6px 14px', borderRadius: 6,
                    border: view === v ? '1px solid var(--accent2)' : '1px solid var(--border)',
                    background: view === v ? 'rgba(129,140,248,0.1)' : 'transparent',
                    color: view === v ? 'var(--accent2)' : 'var(--text-muted)',
                    fontSize: 12
                  }}>
                    {v === 'chart' ? '▦ Chart' : v === 'table' ? '≡ Tabelle' : '✓ Buchen'}
                  </button>
                ))}
              </div>
            </div>

            {view !== 'reconcile' && (
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
            )}

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

                {/* Kumulativer Jahresvergleich (Vorjahr vs Jahr) */}
                {matrix[selectedYear] && matrix[selectedYear - 1] && (
                  <div style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)',
                    borderRadius: 16, padding: '24px 16px', marginTop: 20
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
                      color: 'var(--text-dim)', marginBottom: 20, paddingLeft: 8
                    }}>
                      {selectedYear - 1} zu {selectedYear} – kumuliert (netto)
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={cumulativeYoYData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false}
                          tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                        <Tooltip content={<CumulativeTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="jahr"
                          name="Jahr"
                          stroke="var(--accent2)"
                          strokeWidth={3}
                          dot={{ r: 3 }}
                          connectNulls={false}
                        >
                          <LabelList dataKey="jahr" position="top" formatter={v => (v == null ? '' : fmtInt(v))} />
                        </Line>
                        <Line
                          type="monotone"
                          dataKey="vorjahr"
                          name="Jahr (Vorjahr)"
                          stroke="var(--text-muted)"
                          strokeWidth={3}
                          dot={false}
                        >
                          <LabelList dataKey="vorjahr" position="top" formatter={v => (v == null ? '' : fmtInt(v))} />
                        </Line>
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

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

            {view === 'reconcile' && (
              <div style={{
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 16, padding: 20
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: 16
                }}>
                  <div style={{
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 16
                  }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 10 }}>
                      Sparkasse Datei (CSV)
                    </div>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        const text = await f.text()
                        const tx = parseCsv(text)
                        setTransactions(tx)
                      }}
                      style={{ width: '100%' }}
                    />
                    <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
                      {transactions.length ? `${transactions.length} Zahlungseingänge geladen` : 'Noch keine Datei geladen.'}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                      <label style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                          Suche in Sparkasse-Daten
                        </div>
                        <input
                          value={txQuery}
                          onChange={e => setTxQuery(e.target.value)}
                          placeholder="z.B. RE-2026-001 oder Name"
                          style={{
                            width: '100%', padding: '10px 12px', borderRadius: 8,
                            border: '1px solid var(--border)', background: 'var(--bg2)',
                            color: 'var(--text)', fontSize: 13, outline: 'none'
                          }}
                        />
                      </label>
                      <label style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                          Admin-Token (zum Buchen)
                        </div>
                        <input
                          type="password"
                          value={adminToken}
                          onChange={e => setAdminToken(e.target.value)}
                          placeholder="(Netlify Env BILLOMAT_ADMIN_TOKEN)"
                          style={{
                            width: '100%', padding: '10px 12px', borderRadius: 8,
                            border: '1px solid var(--border)', background: 'var(--bg2)',
                            color: 'var(--text)', fontSize: 13, outline: 'none'
                          }}
                        />
                      </label>
                    </div>
                    <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.6 }}>
                      Buchung nutzt Billomat API: <span style={{ color: 'var(--accent2)' }}>POST /api/invoice-payments</span> (Zahlart: BANK_TRANSFER).
                    </div>
                  </div>

                  <div style={{
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 16
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                        Offene Rechnungen (OPEN/OVERDUE)
                      </div>
                      <button
                        onClick={async () => {
                          setLoading(true)
                          setError('')
                          try {
                            const list = await fetchOpenInvoices()
                            setOpenInvoices(list)
                            setStatus(`${list.length} offene Rechnungen geladen ✓`)
                          } catch (e) {
                            setError(e.message)
                          } finally {
                            setLoading(false)
                          }
                        }}
                        disabled={loading}
                        style={{
                          padding: '8px 14px', borderRadius: 8,
                          border: '1px solid var(--accent)',
                          background: 'rgba(110,231,183,0.1)',
                          color: 'var(--accent)', fontSize: 12,
                          opacity: loading ? 0.6 : 1
                        }}
                      >
                        ↻ Offene laden
                      </button>
                    </div>

                    {openInvoices.length === 0 ? (
                      <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                        Klicke “Offene laden”.
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto', marginTop: 12 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>RE</th>
                              <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Kunde</th>
                              <th style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>Brutto</th>
                              <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Status</th>
                              <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Match (Sparkasse)</th>
                              <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Bezahldatum</th>
                              <th style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>Aktion</th>
                            </tr>
                          </thead>
                          <tbody>
                            {openInvoices.map(inv => {
                              const invId = String(inv.id)
                              const invNo = normalizeInvoiceNumber(inv.invoice_number || inv.number || '')
                              const client = String(inv.client_name || inv.client || '')
                              const gross = parseFloat(inv.total_gross || inv.gross_total || 0)
                              const st = String(inv.status || '').toUpperCase()
                              const selectedTxId = matchByInvoiceId[invId] || ''

                              const q = String(txQuery || '').toLowerCase().trim()
                              const suggested = transactions
                                .filter(t => {
                                  const hay = `${t.purpose} ${t.name} ${t.iban}`.toLowerCase()
                                  const invMatch = invNo && hay.includes(invNo.toLowerCase())
                                  const queryMatch = !q || hay.includes(q)
                                  return invMatch || queryMatch
                                })
                                .slice(0, 50)

                              const selectedTx = transactions.find(t => t.id === selectedTxId) || null
                              const payDate = payDateByInvoiceId[invId] || selectedTx?.dateIso || isoDateToday()

                              return (
                                <tr key={invId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                  <td style={{ padding: '10px 8px', color: 'var(--text)' }}>{inv.invoice_number || inv.number || invId}</td>
                                  <td style={{ padding: '10px 8px', color: 'var(--text-dim)' }}>{client}</td>
                                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text)' }}>{fmt(gross)}</td>
                                  <td style={{ padding: '10px 8px', color: st === 'OVERDUE' ? 'var(--danger)' : 'var(--accent2)' }}>{st}</td>
                                  <td style={{ padding: '10px 8px' }}>
                                    <select
                                      value={selectedTxId}
                                      onChange={e => {
                                        const newTxId = e.target.value
                                        setMatchByInvoiceId(prev => ({ ...prev, [invId]: newTxId }))

                                        const txSel = transactions.find(t => t.id === newTxId) || null
                                        if (txSel?.dateIso && !payDateByInvoiceId[invId]) {
                                          setPayDateByInvoiceId(prev => ({ ...prev, [invId]: txSel.dateIso }))
                                        }
                                      }}
                                      style={{
                                        width: '100%', minWidth: 260,
                                        padding: '8px 10px', borderRadius: 8,
                                        border: '1px solid var(--border)', background: 'var(--bg2)',
                                        color: 'var(--text)', fontSize: 12
                                      }}
                                    >
                                      <option value="">— auswählen —</option>
                                      {suggested.map(t => (
                                        <option key={t.id} value={t.id}>
                                          {(t.dateIso || t.valutaDateRaw || t.bookingDateRaw || '—')} • {fmt(Math.abs(t.amount))} • {(t.purpose || t.name || '').slice(0, 60)}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td style={{ padding: '10px 8px' }}>
                                    <input
                                      type="date"
                                      value={payDate}
                                      onChange={e => setPayDateByInvoiceId(prev => ({ ...prev, [invId]: e.target.value }))}
                                      style={{
                                        padding: '8px 10px', borderRadius: 8,
                                        border: '1px solid var(--border)', background: 'var(--bg2)',
                                        color: 'var(--text)', fontSize: 12
                                      }}
                                    />
                                  </td>
                                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                    <button
                                      onClick={async () => {
                                        if (!adminToken) { setError('Admin-Token fehlt'); return }
                                        if (!selectedTx) { setError('Kein Sparkasse-Match ausgewählt'); return }
                                        const ok = window.confirm(`Zahlung buchen?\n${inv.invoice_number || invId} ← ${selectedTx.date} ${fmt(Math.abs(selectedTx.amount))}`)
                                        if (!ok) return
                                        setBookingBusyId(invId)
                                        setError('')
                                        try {
                                          await bookPayment({ invoice: inv, tx: selectedTx, payDate })
                                          setStatus(`Gebucht: ${inv.invoice_number || invId} ✓`)
                                          // remove from list optimistically
                                          setOpenInvoices(prev => prev.filter(x => String(x.id) !== invId))
                                        } catch (e) {
                                          setError(e.message)
                                        } finally {
                                          setBookingBusyId(null)
                                        }
                                      }}
                                      disabled={bookingBusyId === invId}
                                      style={{
                                        padding: '8px 12px', borderRadius: 8,
                                        border: '1px solid var(--accent2)',
                                        background: 'rgba(129,140,248,0.12)',
                                        color: 'var(--accent2)', fontSize: 12,
                                        opacity: bookingBusyId === invId ? 0.6 : 1
                                      }}
                                    >
                                      {bookingBusyId === invId ? '…' : 'Zahlung buchen'}
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
