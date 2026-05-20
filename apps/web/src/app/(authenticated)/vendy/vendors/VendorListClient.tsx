'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, Search, Plus, ChevronRight, CheckCircle,
  XCircle, Loader2, AlertTriangle,
} from 'lucide-react'
import {
  listVendors, createVendor,
  type VendorSummary,
} from '@/lib/vendy/vendors-api'

const TRADES = [
  'Concrete', 'Framing', 'Roofing', 'Plumbing', 'HVAC', 'Electrical',
  'Insulation', 'Drywall', 'Flooring', 'Painting', 'Cabinetry',
  'Countertops', 'Gutters', 'Landscaping', 'General',
]

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

function VendorCard({ vendor, onClick }: { vendor: VendorSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-gray-200 p-5 hover:border-violet-300 hover:shadow-sm transition-all duration-150 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-semibold text-gray-900 truncate">{vendor.name}</span>
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
          <p className="text-[11px] text-gray-500 mb-3">{vendor.trade}</p>
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Bids Processed</p>
              <p className="text-[13px] font-semibold text-gray-800">{fmt(vendor.bids_processed)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Format</p>
              <p className="text-[12px] text-gray-600 capitalize">{vendor.bid_format.replace('_', ' ')}</p>
            </div>
            {vendor.price_book_last_updated && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Last Activity</p>
                <p className="text-[12px] text-gray-600">
                  {new Date(vendor.price_book_last_updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            )}
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-300 group-hover:text-violet-400 transition-colors mt-1 shrink-0" />
      </div>
    </button>
  )
}

interface SlideOverProps {
  open: boolean
  onClose: () => void
  onCreated: (slug: string) => void
}

function AddVendorSlideOver({ open, onClose, onCreated }: SlideOverProps) {
  const [name, setName] = useState('')
  const [trade, setTrade] = useState('')
  const [email, setEmail] = useState('')
  const [format, setFormat] = useState('itemized')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName(''); setTrade(''); setEmail(''); setFormat('itemized'); setError(null)
  }

  function handleClose() { reset(); onClose() }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !trade.trim() || !email.trim()) {
      setError('All fields are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { vendor_id } = await createVendor({ name: name.trim(), trade, contact_email: email.trim(), bid_format: format })
      reset()
      onClose()
      onCreated(vendor_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vendor')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900">Add Vendor</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Vendor Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. A&E Roofing & Siding"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
            {name && (
              <p className="text-[10px] text-gray-400 mt-1">ID: {slugify(name)}</p>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Trade</label>
            <select
              value={trade}
              onChange={e => setTrade(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            >
              <option value="">Select trade...</option>
              {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Contact Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="contact@vendor.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Bid Format</label>
            <div className="flex gap-3">
              {(['itemized', 'lump_sum'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`flex-1 py-2 rounded-lg border text-[12px] font-medium transition-colors ${
                    format === f
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {f === 'itemized' ? 'Itemized' : 'Lump Sum'}
                </button>
              ))}
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-2 rounded-lg border border-gray-200 text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit as never}
            disabled={saving}
            className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-[13px] font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? 'Saving...' : 'Add Vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VendorListClient() {
  const router = useRouter()
  const [vendors, setVendors] = useState<VendorSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [slideOver, setSlideOver] = useState(false)

  useEffect(() => {
    listVendors()
      .then(setVendors)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = vendors.filter(v => {
    const matchesSearch =
      !query ||
      v.name.toLowerCase().includes(query.toLowerCase()) ||
      v.trade.toLowerCase().includes(query.toLowerCase())
    const matchesFilter =
      activeFilter === 'all' ||
      (activeFilter === 'active' && v.active) ||
      (activeFilter === 'inactive' && !v.active)
    return matchesSearch && matchesFilter
  })

  const activeCount = vendors.filter(v => v.active).length

  return (
    <div className="min-h-screen bg-[#EAEAED]">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Building2 size={20} className="text-violet-600" />
              <h1 className="text-[22px] font-bold text-gray-900">Vendors</h1>
            </div>
            <p className="text-[13px] text-gray-500">
              {loading ? 'Loading...' : `${activeCount} active vendor${activeCount !== 1 ? 's' : ''} · ${vendors.length} total`}
            </p>
          </div>
          <button
            onClick={() => setSlideOver(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-[13px] font-medium rounded-lg hover:bg-violet-700 transition-colors"
          >
            <Plus size={14} /> Add Vendor
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search vendors..."
              className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                activeFilter === f
                  ? 'bg-violet-100 text-violet-700 border border-violet-200'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Vendor grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-violet-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Building2 size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-[14px]">{vendors.length === 0 ? 'No vendors yet. Add your first vendor.' : 'No vendors match your search.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map(v => (
              <VendorCard
                key={v.vendor_id}
                vendor={v}
                onClick={() => router.push(`/vendy/vendors/${v.vendor_id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <AddVendorSlideOver
        open={slideOver}
        onClose={() => setSlideOver(false)}
        onCreated={slug => router.push(`/vendy/vendors/${slug}`)}
      />
    </div>
  )
}
