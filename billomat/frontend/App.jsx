import React, { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, LabelList
} from 'recharts'
import ForderungenView from './ForderungenView'

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

function fmtHours(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num) || num <= 0) return '—'
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(num)
}

function fmtDate(value) {
  const iso = String(value || '').trim()
  if (!iso) return '—'

  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return iso

  const [, year, month, day] = match
  return `${day}.${month}.${year}`
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

function normalizeLooseText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeCompactText(value) {
  return normalizeLooseText(value).replace(/\s+/g, '')
}

function extractCustomerNumber(invoice) {
  const directCandidates = [
    invoice?.customer_number,
    invoice?.customer_no,
    invoice?.client_number,
    invoice?.client_no,
    invoice?.number_customer,
    invoice?.number_client,
    invoice?.customerCode,
    invoice?.clientCode,
    invoice?.customer_code,
    invoice?.client_code,
    invoice?.client?.customer_number,
    invoice?.client?.client_number,
    invoice?.client?.number,
    invoice?.client?.code,
    invoice?.customer?.number,
    invoice?.customer?.code
  ]

  for (const value of directCandidates) {
    const normalized = String(value || '').trim()
    if (normalized) return normalized
  }

  return ''
}

function extractCustomerTokens(value) {
  const normalized = normalizeCompactText(value)
  if (!normalized) return []

  const tokens = new Set([normalized])
  const kdTokens = normalized.match(/kd\d{1,}/g) || []
  for (const token of kdTokens) tokens.add(token)
  return Array.from(tokens)
}
function extractOverviewInfo(invoice) {
  const parts = []
  const customerNumber = extractCustomerNumber(invoice)
  const note = String(invoice.note || invoice.comment || invoice.description || '').trim()
  const dueDate = String(invoice.due_date || '').trim()
  const paidDate = String(invoice.paid_date || '').trim()

  if (customerNumber) parts.push(`Kd.-Nr. ${customerNumber}`)
  if (dueDate) parts.push(`Fällig ${fmtDate(dueDate)}`)
  if (paidDate) parts.push(`Bezahlt ${fmtDate(paidDate)}`)
  if (note) parts.push(note)

  return parts.length ? parts.join(' • ') : '—'
}

function extractWorkedHours(invoice) {
  const candidates = [invoice?.worked_hours, invoice?.hours, invoice?.service_hours, invoice?.duration_hours]

  for (const value of candidates) {
    const num = Number(value)
    if (Number.isFinite(num) && num > 0) return num
  }

  return 0
}

function getCurrentYear() { return new Date().getFullYear() }

// Fetch via Netlify Function (API key stays server-side)
async function fetchInvoices(setStatus, options = {}) {
  const { from = '', label = 'Lade Rechnungen…', includeClients = false } = options
  setStatus(label)
  const url = new URL('/.netlify/functions/billomat-invoices', window.location.origin)
  if (from) {
    url.searchParams.set('from', from)
  }
  if (includeClients) {
    url.searchParams.set('includeClients', '1')
  }
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
  const [view, setView] = useState('chart') // chart | table | overview | forderungen

  // Token für die Forderungs-Datenbank (Admin- oder Lese-Token), bleibt im Browser gespeichert
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('bm_admin_token') || '')
  const [overviewQuery, setOverviewQuery] = useState('')
  const [overviewStatusFilter, setOverviewStatusFilter] = useState('ALL')

  const kpis = invoices.length ? buildKPIs(invoices) : null
  const { matrix, years, thisYear, thisMonth } = invoices.length
    ? buildMatrix(invoices)
    : { matrix: {}, years: [], thisYear: getCurrentYear(), thisMonth: new Date().getMonth() }

  const chartData = years.length ? yearToChartData(matrix, selectedYear, thisYear, thisMonth) : []
  const cumulativeYoYData = years.length ? yearToCumulativeYoYData(matrix, selectedYear, thisYear, thisMonth) : []

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setStatus('Verbinde…')
    try {
      const data = await fetchInvoices(setStatus, {
        from: `${getCurrentYear()}-01-01`,
        label: `Lade Rechnungen ab 01.01.${getCurrentYear()}…`,
        includeClients: true
      })
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

  const loadAllInvoices = useCallback(async () => {
    setLoading(true)
    setError('')
    setStatus('Verbinde…')
    try {
      const data = await fetchInvoices(setStatus, {
        label: 'Lade alle Rechnungsdaten…',
        includeClients: true
      })
      setInvoices(data)
      setStatus(`${data.length} Rechnungen vollständig geladen ✓`)
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
  const normalizedOverviewQuery = normalizeLooseText(overviewQuery)
  const overviewInvoices = invoices.filter(inv => {
    const statusKey = String(inv.status || '').toUpperCase()
    if (overviewStatusFilter !== 'ALL' && statusKey !== overviewStatusFilter) return false
    if (!normalizedOverviewQuery) return true
    const hay = normalizeLooseText([
      inv.client_name,
      inv.client?.name,
      extractCustomerNumber(inv),
      inv.invoice_number,
      inv.number,
      inv.invoice_date,
      inv.note,
      inv.comment,
      inv.status
    ].filter(Boolean).join(' '))
    return hay.includes(normalizedOverviewQuery)
  })
    .sort((a, b) => {
      const byClient = String(a.client_name || a.client?.name || '').localeCompare(String(b.client_name || b.client?.name || ''), 'de')
      if (byClient !== 0) return byClient
      return String(b.invoice_date || b.date || '').localeCompare(String(a.invoice_date || a.date || ''))
    })
  const overviewSummary = overviewInvoices.reduce((acc, invoice) => {
    const statusKey = String(invoice.status || '').toUpperCase()
    acc.total += 1
    if (statusKey === 'PAID') acc.paid += 1
    if (statusKey === 'OPEN') acc.open += 1
    if (statusKey === 'OVERDUE') acc.overdue += 1
    return acc
  }, { total: 0, paid: 0, open: 0, overdue: 0 })

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
            RECHNUNGSAUSWERTUNG / NETTO / UEBERSICHT
          </div>
          <div style={{ color: 'var(--accent2)', fontSize: 11, marginTop: 6 }}>
            Build 2026-07-08 B
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

            <button
              onClick={loadAllInvoices}
              disabled={loading}
              style={{
                width: '100%', padding: '12px', borderRadius: 10,
                border: '1px solid var(--accent2)', background: 'transparent',
                color: 'var(--accent2)', fontFamily: 'var(--font-display)',
                fontWeight: 700, fontSize: 14, opacity: loading ? 0.5 : 1,
                transition: 'opacity .2s', marginTop: 10
              }}
            >
              {loading ? status : '→ Alle Rechnungsdaten laden'}
            </button>
            <div style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 11 }}>
              Lädt alle Rechnungen ohne Jahresfilter.
            </div>

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
                {view === 'forderungen' ? 'Offene Forderungen' : view === 'overview' ? 'Kundenübersicht' : 'Monatliche Auswertung'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['chart', 'table', 'overview', 'forderungen'].map(v => (
                  <button key={v} onClick={() => setView(v)} style={{
                    padding: '6px 14px', borderRadius: 6,
                    border: view === v ? '1px solid var(--accent2)' : '1px solid var(--border)',
                    background: view === v ? 'rgba(129,140,248,0.1)' : 'transparent',
                    color: view === v ? 'var(--accent2)' : 'var(--text-muted)',
                    fontSize: 12
                  }}>
                    {v === 'chart' ? '▦ Chart' : v === 'table' ? '≡ Tabelle' : v === 'overview' ? '⌕ Übersicht' : '€ Forderungen'}
                  </button>
                ))}
              </div>
            </div>

            {view !== 'forderungen' && view !== 'overview' && (
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

            {view === 'overview' && (
              <div style={{
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 16, padding: 20
              }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                      Suche nach Kunde, Kundennummer oder Rechnung
                    </div>
                    <input
                      value={overviewQuery}
                      onChange={e => setOverviewQuery(e.target.value)}
                      placeholder="z.B. KD308, MECO oder Schulz"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8,
                        border: '1px solid var(--border)', background: 'var(--bg3)',
                        color: 'var(--text)', fontSize: 13, outline: 'none'
                      }}
                    />
                  </label>
                  <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5 }}>
                    Nutzt nur bereits geladene Rechnungsdaten. Suche nach Kunde, Kundennummer, Rechnungsnummer oder Rechnungsdatum.
                  </div>
                  <div style={{ marginTop: 6, color: 'var(--text-dim)', fontSize: 11 }}>
                    Übersicht ohne zusätzliche Billomat-Abfragen.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {[
                      { key: 'ALL', label: 'Alle' },
                      { key: 'PAID', label: 'Bezahlt' },
                      { key: 'OPEN', label: 'Offen' },
                      { key: 'OVERDUE', label: 'Überfällig' }
                    ].map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setOverviewStatusFilter(opt.key)}
                        style={{
                          padding: '6px 12px', borderRadius: 999,
                          border: overviewStatusFilter === opt.key ? '1px solid var(--accent2)' : '1px solid var(--border)',
                          background: overviewStatusFilter === opt.key ? 'rgba(129,140,248,0.12)' : 'transparent',
                          color: overviewStatusFilter === opt.key ? 'var(--accent2)' : 'var(--text-muted)',
                          fontSize: 12
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
                  {overviewInvoices.length
                    ? `${overviewInvoices.length} Rechnungen in der Übersicht`
                    : 'Keine passenden Rechnungen gefunden.'}
                </div>

                <div style={{ color: 'var(--accent2)', fontSize: 11, marginBottom: 14 }}>
                  Übersicht Build Live 2026-07-08
                </div>

                {overviewInvoices.length > 0 && (
                  <div style={{
                    display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14,
                    color: 'var(--text-muted)', fontSize: 12
                  }}>
                    <div>Gesamt: <span style={{ color: 'var(--text)' }}>{overviewSummary.total}</span></div>
                    <div>Bezahlt: <span style={{ color: '#6ee7b7' }}>{overviewSummary.paid}</span></div>
                    <div>Offen: <span style={{ color: 'var(--accent2)' }}>{overviewSummary.open}</span></div>
                    <div>Überfällig: <span style={{ color: 'var(--danger)' }}>{overviewSummary.overdue}</span></div>
                  </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Kunde</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Kd.-Nr.</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Rechnung</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Datum</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Status</th>
                        <th style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>Betrag</th>
                        <th style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>Stunden</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--text-muted)' }}>Weitere Informationen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewInvoices.map(inv => {
                        const statusKey = String(inv.status || '').toUpperCase()
                        const statusLabel = STATUS_LABELS[statusKey] || statusKey || '—'
                        const statusColor = STATUS_COLORS[statusKey] || 'var(--text-dim)'
                        return (
                          <tr key={String(inv.id)} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '10px 8px', color: 'var(--text)' }}>{inv.client_name || inv.client?.name || '—'}</td>
                            <td style={{ padding: '10px 8px', color: 'var(--text-dim)' }}>{extractCustomerNumber(inv) || '—'}</td>
                            <td style={{ padding: '10px 8px', color: 'var(--text)' }}>{inv.invoice_number || inv.number || inv.id}</td>
                            <td style={{ padding: '10px 8px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{fmtDate(inv.invoice_date || inv.date || '')}</td>
                            <td style={{ padding: '10px 8px', color: statusColor }}>{statusLabel}</td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text)' }}>{fmt(inv.total_gross || inv.gross_total || 0)}</td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text)' }}>{fmtHours(extractWorkedHours(inv))}</td>
                            <td style={{ padding: '10px 8px', color: 'var(--text-dim)', minWidth: 280 }}>{extractOverviewInfo(inv)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
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

            {view === 'forderungen' && (
              <ForderungenView adminToken={adminToken} setAdminToken={setAdminToken} setStatus={setStatus} setError={setError} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

