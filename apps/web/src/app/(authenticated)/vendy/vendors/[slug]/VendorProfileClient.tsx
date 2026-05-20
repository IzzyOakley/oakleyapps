'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, CheckCircle, XCircle, ChevronDown,
  ChevronRight, Loader2, AlertTriangle, BookOpen, ToggleLeft, ToggleRight,
} from 'lucide-react'
import {
  getVendor, updateVendorActive, getVendorBidLedger,
  type VendorDetail, type BidLedgerEntry, type PriceBookEntry,
} from '@/lib/vendy/vendors-api'

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Price Book Panel ──────────────────────────────────────────────────────────

function StatsCell({ stats }: { stats: { min: number | null; max: number | null; avg: number | null; sample_count: number } }) {
  if (stats.sample_count === 0) return <span className="text-gray-300 text-[11px]">—</span>
  return (
    <div className="text-[11px]">
      <span className="font-medium text-gray-800">${fmt(stats.avg)}</span>
      <span className="text-gray-400 ml-1">avg</span>
      <span className="text-gray-400 mx-1">·</span>
      <span className="text-gray-500">${fmt(stats.min)}–${fmt(stats.max)}</span>
      <span className="text-gray-400 ml-1">({stats.sample_count})</span>
    </div>
  )
}

function PriceBookPanel({ priceBook }: { priceBook: VendorDetail['price_book'] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const categories = Object.entries(priceBook.categories ?? {})

  if (categories.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400">
        <BookOpen size={28} className="mx-auto mb-2 opacity-30" />
        <p className="text-[13px]">No pricing data yet. Price book builds automatically as bids are awarded.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {categories.map(([costCode, items]) => {
        const isOpen = expanded[costCode] ?? false
        const itemCount = Object.keys(items).length
        return (
          <div key={costCode} className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(prev => ({ ...prev, [costCode]: !isOpen }))}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-semibold text-gray-500 bg-gray-200 rounded-md px-2 py-0.5">{costCode}</span>
                <span className="text-[13px] font-medium text-gray-800">
                  {Object.values(items)[0]?.cost_code_name ?? costCode}
                </span>
                <span className="text-[11px] text-gray-400">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
              </div>
              {isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
            </button>
            {isOpen && (
              <div className="divide-y divide-gray-100">
                {Object.entries(items as Record<string, PriceBookEntry>).map(([desc, entry]) => (
                  <div key={desc} className="px-4 py-3">
                    <p className="text-[12px] font-medium text-gray-800 mb-2 leading-snug">{desc}</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                      <div>
                        <p className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wide mb-0.5">Awarded — Extension</p>
                        <StatsCell stats={entry.awarded.extension} />
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">Not Awarded — Extension</p>
                        <StatsCell stats={entry.not_awarded.extension} />
                      </div>
                      {(entry.awarded.unit_price.sample_count > 0 || entry.not_awarded.unit_price.sample_count > 0) && (
                        <>
                          <div>
                            <p className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wide mb-0.5">Awarded — Unit Price</p>
                            <StatsCell stats={entry.awarded.unit_price} />
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">Not Awarded — Unit Price</p>
                            <StatsCell stats={entry.not_awarded.unit_price} />
                          </div>
                        </>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5">Last seen: {fmtDate(entry.awarded.last_seen ?? entry.not_awarded.last_seen)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Bid Ledger Table ──────────────────────────────────────────────────────────

function BidLedgerTable({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<BidLedgerEntry[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [outcome, setOutcome] = useState<'awarded' | 'not_awarded' | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getVendorBidLedger(slug, page, outcome)
      .then(data => { setEntries(data.entries); setHasMore(data.has_more) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug, page, outcome])

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {([undefined, 'awarded', 'not_awarded'] as const).map(f => (
          <button
            key={String(f)}
            onClick={() => { setOutcome(f); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              outcome === f
                ? 'bg-violet-100 text-violet-700 border border-violet-200'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {f === undefined ? 'All' : f === 'awarded' ? 'Awarded' : 'Not Awarded'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} className="animate-spin text-violet-600" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-[13px]">No bid history yet.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Date</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Project</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Cost Code</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Outcome</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map(e => (
                  <tr key={e.bid_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{fmtDate(e.bid_date)}</td>
                    <td className="px-4 py-3 text-gray-800 font-medium">{e.project_name}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 mr-1.5">{e.cost_code}</span>
                      <span className="text-gray-600">{e.cost_code_name}</span>
                    </td>
                    <td className="px-4 py-3">
                      {e.outcome === 'awarded' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                          <CheckCircle size={10} /> Awarded
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                          <XCircle size={10} /> Not Awarded
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">
                      {e.subtotal != null ? `$${fmt(e.subtotal)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(hasMore || page > 1) && (
            <div className="flex items-center justify-between mt-3 text-[12px] text-gray-500">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                disabled={!hasMore}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Profile ──────────────────────────────────────────────────────────────

type Tab = 'price_book' | 'bid_ledger'

export default function VendorProfileClient({ slug }: { slug: string }) {
  const router = useRouter()
  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<Tab>('price_book')
  const [togglingActive, setTogglingActive] = useState(false)

  useEffect(() => {
    getVendor(slug)
      .then(setVendor)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  async function handleToggleActive() {
    if (!vendor) return
    setTogglingActive(true)
    try {
      const { active } = await updateVendorActive(slug, !vendor.active)
      setVendor(prev => prev ? { ...prev, active } : prev)
    } catch {
      /* ignore */
    } finally {
      setTogglingActive(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#EAEAED] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-violet-600" />
      </div>
    )
  }

  if (notFound || !vendor) {
    return (
      <div className="min-h-screen bg-[#EAEAED] flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-amber-500" />
          <p className="text-[14px] text-gray-600">Vendor not found.</p>
          <button onClick={() => router.back()} className="mt-3 text-[12px] text-violet-600 hover:underline">Go back</button>
        </div>
      </div>
    )
  }

  const pb = vendor.price_book ?? { last_updated: null, bids_processed: 0, categories: {} }

  return (
    <div className="min-h-screen bg-[#EAEAED]">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Back nav */}
        <button
          onClick={() => router.push('/vendy/vendors')}
          className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-700 mb-5 transition-colors"
        >
          <ArrowLeft size={14} /> All Vendors
        </button>

        {/* Header card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <Building2 size={22} className="text-violet-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h1 className="text-[20px] font-bold text-gray-900">{vendor.name}</h1>
                  {vendor.active ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                      <CheckCircle size={10} /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                      <XCircle size={10} /> Inactive
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-gray-500">{vendor.trade} · {vendor.contact_email}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {vendor.bid_format === 'itemized' ? 'Itemized bids' : 'Lump-sum bids'} · ID: {vendor.vendor_id}
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleActive}
              disabled={togglingActive}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors ${
                vendor.active
                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                  : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
              } disabled:opacity-40`}
            >
              {togglingActive ? (
                <Loader2 size={13} className="animate-spin" />
              ) : vendor.active ? (
                <ToggleLeft size={13} />
              ) : (
                <ToggleRight size={13} />
              )}
              {vendor.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-gray-100">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Bids Processed</p>
              <p className="text-[20px] font-bold text-gray-900">{pb.bids_processed}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Cost Codes Tracked</p>
              <p className="text-[20px] font-bold text-gray-900">{Object.keys(pb.categories ?? {}).length}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Last Activity</p>
              <p className="text-[14px] font-semibold text-gray-800">{fmtDate(pb.last_updated)}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-white border border-gray-200 rounded-xl p-1 w-fit">
          {([['price_book', 'Price Book'], ['bid_ledger', 'Bid History']] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                tab === t ? 'bg-violet-600 text-white' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {tab === 'price_book' && <PriceBookPanel priceBook={pb} />}
          {tab === 'bid_ledger' && <BidLedgerTable slug={slug} />}
        </div>
      </div>
    </div>
  )
}
