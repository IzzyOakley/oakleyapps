'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, CheckCircle, XCircle, ChevronDown,
  ChevronRight, Loader2, AlertTriangle, BookOpen, ToggleLeft,
  ToggleRight, Pencil, Mail, Check, X, Search,
} from 'lucide-react'
import {
  getVendor, updateVendor, updateVendorCostCodes, listAllCostCodes, getVendorBidLedger,
  type VendorDetail, type VendorCostCode, type CostCodeOption,
  type BidLedgerEntry, type PriceBookEntry,
} from '@/lib/vendy/vendors-api'

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function deslugify(slug: string) {
  return slug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function displayName(vendor: VendorDetail) {
  return vendor.name?.trim() || deslugify(vendor.vendor_id)
}

function CostCodePills({ codes }: { codes: VendorCostCode[] }) {
  if (codes.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {codes.map(c => (
        <span
          key={c.full_code}
          className="inline-flex items-center text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-md px-2 py-0.5"
        >
          {c.full_code}·{c.name}
        </span>
      ))}
    </div>
  )
}

function CostCodePicker({
  allCodes,
  selected,
  onChange,
  loading,
}: {
  allCodes: CostCodeOption[]
  selected: Set<string>
  onChange: (codes: Set<string>) => void
  loading: boolean
}) {
  const [search, setSearch] = useState('')

  const filtered = allCodes.filter(
    c =>
      !search ||
      c.full_code.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.category.toLowerCase().includes(search.toLowerCase())
  )

  // Group by category, sorted
  const grouped = filtered.reduce<Record<string, CostCodeOption[]>>((acc, c) => {
    const cat = c.category || 'Other'
    ;(acc[cat] ??= []).push(c)
    return acc
  }, {})

  function toggle(code: string) {
    const next = new Set(selected)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange(next)
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden">
      {/* Search bar + count */}
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search cost codes..."
            className="w-full pl-7 pr-3 py-1.5 text-[12px] bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <span className="text-[11px] font-semibold text-violet-600 shrink-0">
          {selected.size} selected
        </span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={18} className="animate-spin text-violet-500" />
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([cat, codes]) => (
              <div key={cat}>
                <div className="px-3 py-1.5 bg-gray-50 sticky top-0 z-10">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    {cat}
                  </span>
                </div>
                {codes.map(c => (
                  <label
                    key={c.full_code}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-violet-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.full_code)}
                      onChange={() => toggle(c.full_code)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500 shrink-0"
                    />
                    <span className="text-[10px] font-semibold text-gray-400 w-9 shrink-0">
                      {c.full_code}
                    </span>
                    <span className="text-[12px] text-gray-800">{c.name}</span>
                  </label>
                ))}
              </div>
            ))}
          {filtered.length === 0 && (
            <p className="text-[12px] text-gray-400 text-center py-6">No cost codes match.</p>
          )}
        </div>
      )}
    </div>
  )
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
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                Previous
              </button>
              <span>Page {page}</span>
              <button disabled={!hasMore} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Vendor Header Card ────────────────────────────────────────────────────────

interface HeaderCardProps {
  vendor: VendorDetail
  slug: string
  onUpdated: (updated: Partial<VendorDetail>) => void
}

function VendorHeaderCard({ vendor, slug, onUpdated }: HeaderCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [togglingActive, setTogglingActive] = useState(false)

  // Cost code picker state
  const [allCodes, setAllCodes] = useState<CostCodeOption[]>([])
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())
  const [loadingCodes, setLoadingCodes] = useState(false)

  async function startEdit() {
    setEditName(vendor.name || '')
    setEditEmail(vendor.contact_email || '')
    // Pre-select current vendor cost codes
    setSelectedCodes(new Set((vendor.cost_codes ?? []).map(c => c.full_code)))
    setSaveError(null)
    setIsEditing(true)
    // Fetch all cost codes for the picker
    if (allCodes.length === 0) {
      setLoadingCodes(true)
      try {
        const codes = await listAllCostCodes()
        setAllCodes(codes)
      } catch { /* ignore — picker will show empty */ }
      finally { setLoadingCodes(false) }
    }
  }

  function cancelEdit() {
    setIsEditing(false)
    setSaveError(null)
  }

  async function saveInfo() {
    setSaving(true)
    setSaveError(null)
    try {
      // Update vendor fields (name, email)
      const updates: Record<string, string> = {}
      if (editName.trim()) updates.name = editName.trim()
      if (editEmail.trim()) updates.contact_email = editEmail.trim()
      if (Object.keys(updates).length > 0) {
        await updateVendor(slug, updates)
      }
      // Update cost codes (always sync — even if unchanged, it's idempotent)
      const newCodesList = [...selectedCodes]
      await updateVendorCostCodes(slug, newCodesList)
      // Reflect changes locally
      const newCostCodes = allCodes
        .filter(c => selectedCodes.has(c.full_code))
        .map(c => ({ full_code: c.full_code, name: c.name }))
      onUpdated({ ...(updates as Partial<VendorDetail>), cost_codes: newCostCodes })
      setIsEditing(false)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive() {
    setTogglingActive(true)
    try {
      await updateVendor(slug, { active: !vendor.active })
      onUpdated({ active: !vendor.active })
    } catch { /* ignore */ }
    finally { setTogglingActive(false) }
  }

  const pb = vendor.price_book ?? { last_updated: null, bids_processed: 0, categories: {} }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5">
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <Building2 size={22} className="text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-4">
                {saveError && (
                  <p className="text-[11px] text-red-600 flex items-center gap-1">
                    <AlertTriangle size={11} /> {saveError}
                  </p>
                )}
                {/* Row: Name + Email */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Vendor Name</label>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="e.g. A&E Roofing & Siding"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Contact Email</label>
                    <div className="relative">
                      <Mail size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={editEmail}
                        onChange={e => setEditEmail(e.target.value)}
                        placeholder="contact@vendor.com"
                        className="w-full pl-7 pr-3 border border-gray-300 rounded-lg py-1.5 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
                {/* Cost code picker */}
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Cost Codes &amp; Trades
                  </label>
                  <CostCodePicker
                    allCodes={allCodes}
                    selected={selectedCodes}
                    onChange={setSelectedCodes}
                    loading={loadingCodes}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveInfo}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[12px] font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <X size={12} /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h1 className="text-[20px] font-bold text-gray-900 leading-tight">{displayName(vendor)}</h1>
                  {vendor.active ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">
                      <CheckCircle size={10} /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 shrink-0">
                      <XCircle size={10} /> Inactive
                    </span>
                  )}
                </div>

                {/* Contact details row */}
                <div className="flex flex-wrap items-center gap-4 mt-2">
                  <div className="flex items-center gap-1.5">
                    <Mail size={12} className="text-gray-400 shrink-0" />
                    {vendor.contact_email ? (
                      <a href={`mailto:${vendor.contact_email}`} className="text-[13px] text-violet-600 hover:underline font-medium">
                        {vendor.contact_email}
                      </a>
                    ) : (
                      <button onClick={startEdit} className="text-[12px] text-violet-500 hover:underline italic">Add email</button>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-400">ID: {vendor.vendor_id}</span>
                </div>
                {/* Cost codes */}
                <CostCodePills codes={vendor.cost_codes ?? []} />
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {!isEditing && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={startEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Pencil size={12} /> Edit
            </button>
            <button
              onClick={toggleActive}
              disabled={togglingActive}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors ${
                vendor.active
                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                  : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
              } disabled:opacity-40`}
            >
              {togglingActive ? (
                <Loader2 size={12} className="animate-spin" />
              ) : vendor.active ? (
                <ToggleLeft size={13} />
              ) : (
                <ToggleRight size={13} />
              )}
              {vendor.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-gray-100">
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Bids Processed</p>
          <p className="text-[22px] font-bold text-gray-900">{pb.bids_processed}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Cost Codes Tracked</p>
          <p className="text-[22px] font-bold text-gray-900">{Object.keys(pb.categories ?? {}).length}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Last Activity</p>
          <p className="text-[14px] font-semibold text-gray-800">{fmtDate(pb.last_updated)}</p>
        </div>
      </div>
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

  useEffect(() => {
    getVendor(slug)
      .then(setVendor)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  function handleUpdated(updated: Partial<VendorDetail>) {
    setVendor(prev => prev ? { ...prev, ...updated } : prev)
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

        {/* Header card with edit capability */}
        <VendorHeaderCard vendor={vendor} slug={slug} onUpdated={handleUpdated} />

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
