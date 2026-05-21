'use client'

import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { AlertTriangle, Loader2, TrendingUp, Award, BarChart2, Layers } from 'lucide-react'
import {
  getAnalyticsSummary, getVendorWinRates, getCoverage, getCostVsBudget,
} from '@/lib/vendy/analytics-api'
import type { AnalyticsSummary, VendorWinRate, CoverageRow, CostBudgetRow } from '@/lib/vendy/analytics-api'

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtK(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${fmt(n)}`
}

// ── Stat cards ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent, icon, loading,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
  icon: React.ReactNode
  loading?: boolean
}) {
  return (
    <div className="bg-surface border border-border rounded-[14px] px-5 py-4 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-surface-raised flex items-center justify-center shrink-0 text-text-muted">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-1">{label}</p>
        {loading
          ? <div className="h-6 w-24 bg-surface-raised rounded animate-pulse" />
          : <p className={`text-[20px] font-semibold tabular-nums font-mono ${accent ?? 'text-text-primary'}`}>{value}</p>}
        {sub && !loading && <p className="text-[11px] text-text-secondary mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ── Vendor win rate chart ────────────────────────────────────────────────────

function VendorWinRateChart({ costCodes }: { costCodes: { code: string; name: string }[] }) {
  const [data, setData] = useState<VendorWinRate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCode, setSelectedCode] = useState<string>('')

  useEffect(() => {
    setLoading(true)
    setError(null)
    getVendorWinRates(selectedCode || undefined)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedCode])

  const chartData = data.map(d => ({
    name: d.vendor_name,
    win_rate: d.win_rate_pct,
    awarded: d.awarded,
    total: d.total,
  }))

  return (
    <div className="bg-surface border border-border rounded-[14px] p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-[13px] font-semibold text-text-primary">Vendor Win Rate</p>
          <p className="text-[11px] text-text-secondary mt-0.5">Awarded ÷ total bids — min 2 bids to appear</p>
        </div>
        <select
          value={selectedCode}
          onChange={e => setSelectedCode(e.target.value)}
          className="text-[11px] bg-surface-raised border border-border rounded-lg px-2.5 py-1.5 text-text-primary outline-none focus:border-primary shrink-0"
        >
          <option value="">All cost codes</option>
          {costCodes.map(c => (
            <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-warning text-[12px] h-48 justify-center">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {!loading && !error && chartData.length === 0 && (
        <div className="flex items-center justify-center h-48 text-text-muted text-[12px]">
          No data yet — bids need to reach awarded/not_awarded status first.
        </div>
      )}
      {!loading && !error && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 40)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={v => `${v}%`}
              tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="name"
              type="category"
              width={140}
              tick={{ fontSize: 11, fill: 'var(--color-text-primary)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any) => [`${value}%`, 'Win rate'] as any}
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="win_rate" radius={[0, 4, 4, 0]} maxBarSize={24}>
              {chartData.map((_, i) => (
                <Cell key={i} fill="var(--color-primary)" fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Coverage chart ────────────────────────────────────────────────────────────

function CoverageChart() {
  const [data, setData] = useState<CoverageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCoverage()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const chartData = data.map(d => ({
    name: `${d.cost_code}·${d.cost_code_name}`,
    short: d.cost_code_name,
    awarded: d.awarded_count,
    thin: d.thin_coverage,
    vendors: d.vendor_count,
    total: d.total_count,
  }))

  return (
    <div className="bg-surface border border-border rounded-[14px] p-5">
      <div className="mb-5">
        <p className="text-[13px] font-semibold text-text-primary">Price Book Coverage</p>
        <p className="text-[11px] text-text-secondary mt-0.5">
          Awarded bids per cost code —{' '}
          <span className="text-warning font-medium">amber = fewer than 3 awarded bids (thin data)</span>
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-warning text-[12px] h-48 justify-center">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {!loading && !error && chartData.length === 0 && (
        <div className="flex items-center justify-center h-48 text-text-muted text-[12px]">
          No coverage data yet.
        </div>
      )}
      {!loading && !error && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="short"
              tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
              axisLine={false}
              tickLine={false}
              angle={-45}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any) => [value, 'Awarded bids'] as any}
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="awarded" radius={[4, 4, 0, 0]} maxBarSize={32}>
              {chartData.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.thin ? 'var(--color-warning)' : 'var(--color-primary)'}
                  fillOpacity={d.thin ? 0.75 : 0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Cost vs budget table ──────────────────────────────────────────────────────

function CostBudgetTable() {
  const [data, setData] = useState<CostBudgetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(false)
  const [overBudgetOnly, setOverBudgetOnly] = useState(false)

  useEffect(() => {
    getCostVsBudget()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = data.filter(r => {
    if (activeOnly && r.status !== 'open') return false
    if (overBudgetOnly && !r.over_budget) return false
    return true
  })

  return (
    <div className="bg-surface border border-border rounded-[14px] p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-[13px] font-semibold text-text-primary">Cost vs Budget</p>
          <p className="text-[11px] text-text-secondary mt-0.5">
            Total awarded bids vs project budget — sorted by variance
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={e => setActiveOnly(e.target.checked)}
              className="w-3.5 h-3.5 accent-primary"
            />
            <span className="text-[11px] text-text-secondary">Active only</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={overBudgetOnly}
              onChange={e => setOverBudgetOnly(e.target.checked)}
              className="w-3.5 h-3.5 accent-primary"
            />
            <span className="text-[11px] text-text-secondary">Over budget only</span>
          </label>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-warning text-[12px] justify-center py-8">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-text-secondary pb-2 pr-4">Project</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-text-secondary pb-2 px-4">Budget</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-text-secondary pb-2 px-4">Awarded</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-text-secondary pb-2 px-4">Variance $</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-text-secondary pb-2 pl-4">Variance %</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-text-muted">
                    {data.length === 0
                      ? 'No active projects yet — add a total_budget field to projects in Firestore to enable this view.'
                      : 'No projects match the current filters.'}
                  </td>
                </tr>
              )}
              {filtered.map(r => (
                <tr key={r.project_id} className="border-b border-border/50 hover:bg-surface-raised/50 transition-colors">
                  <td className="py-2.5 pr-4 text-text-primary font-medium">{r.project_name}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-text-secondary">
                    {r.budget != null ? `$${fmt(r.budget)}` : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-text-primary">
                    {r.awarded_total > 0 ? `$${fmt(r.awarded_total)}` : <span className="text-text-muted">$0</span>}
                  </td>
                  <td className={`py-2.5 px-4 text-right font-mono ${
                    r.variance == null ? 'text-text-muted' :
                    r.over_budget ? 'text-error' : 'text-success'
                  }`}>
                    {r.variance != null
                      ? `${r.over_budget ? '+' : ''}$${fmt(Math.abs(r.variance))}`
                      : '—'}
                  </td>
                  <td className={`py-2.5 pl-4 text-right font-mono ${
                    r.variance_pct == null ? 'text-text-muted' :
                    r.over_budget ? 'text-error' : 'text-success'
                  }`}>
                    {r.variance_pct != null
                      ? `${r.over_budget ? '+' : ''}${r.variance_pct}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export default function AnalyticsClient() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [costCodes, setCostCodes] = useState<{ code: string; name: string }[]>([])

  useEffect(() => {
    getAnalyticsSummary()
      .then(setSummary)
      .catch(e => setSummaryError(e.message))
      .finally(() => setSummaryLoading(false))

    // Load cost codes for the win rate filter
    fetch('/api/vendy/cost-codes')
      .then(r => r.json())
      .then((codes: { full_code: string; name: string }[]) =>
        setCostCodes(codes.map(c => ({ code: c.full_code, name: c.name })))
      )
      .catch(() => { /* best-effort */ })
  }, [])

  return (
    <div className="animate-in fade-in max-w-4xl">
      <div className="mb-7">
        <h1 className="text-[18px] font-semibold text-text-primary tracking-tight">Analytics</h1>
        <p className="text-[13px] text-text-secondary mt-1">
          Bid performance, vendor win rates, and cost-vs-budget tracking.
        </p>
      </div>

      {summaryError && (
        <div className="flex items-start gap-3 px-4 py-3 mb-6 bg-warning-bg border border-warning/20 rounded-xl">
          <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
          <p className="text-[12px] text-text-secondary">{summaryError}</p>
        </div>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard
          label={`Awarded ${new Date().getFullYear()}`}
          value={summary ? fmtK(summary.total_awarded_ytd) : '—'}
          accent="text-primary"
          icon={<Award size={18} />}
          loading={summaryLoading}
        />
        <StatCard
          label="Bids processed"
          value={summary ? String(summary.total_bids_processed) : '—'}
          icon={<Layers size={18} />}
          loading={summaryLoading}
        />
        <StatCard
          label="Most active code"
          value={summary?.most_active_cost_code ?? '—'}
          icon={<BarChart2 size={18} />}
          loading={summaryLoading}
        />
        <StatCard
          label="Top win rate"
          value={summary ? `${summary.top_vendor_win_rate.win_rate_pct}%` : '—'}
          sub={summary?.top_vendor_win_rate.vendor_id.replace(/_/g, ' ')}
          accent="text-success"
          icon={<TrendingUp size={18} />}
          loading={summaryLoading}
        />
      </div>

      {/* Charts grid */}
      <div className="space-y-6">
        <VendorWinRateChart costCodes={costCodes} />
        <CoverageChart />
        <CostBudgetTable />
      </div>
    </div>
  )
}
