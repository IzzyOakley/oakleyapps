'use client'

import * as React from 'react'
import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from './utils'

export interface Column<T> {
  key: keyof T | string
  header: string
  sortable?: boolean
  className?: string
  render?: (value: unknown, row: T) => React.ReactNode
}

interface DataTableProps<T extends Record<string, unknown>> {
  data: T[]
  columns: Column<T>[]
  pageSize?: number
  className?: string
  emptyMessage?: string
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  pageSize = 20,
  className,
  emptyMessage = 'No data found',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(0)
  }

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : data

  const totalPages = Math.ceil(sorted.length / pageSize)
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div className={cn('bg-surface border border-border rounded-2xl overflow-hidden', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-raised border-b border-border">
            {columns.map(col => (
              <th
                key={String(col.key)}
                className={cn(
                  'text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-text-muted',
                  col.sortable && 'cursor-pointer hover:text-text-secondary select-none',
                  col.className,
                )}
                onClick={col.sortable ? () => handleSort(String(col.key)) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    sortKey === String(col.key) ? (
                      sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    ) : (
                      <ChevronsUpDown size={12} className="opacity-40" />
                    )
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paged.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-5 py-8 text-center text-text-muted">{emptyMessage}</td>
            </tr>
          )}
          {paged.map((row, i) => (
            <tr key={i} className="border-t border-border hover:bg-surface-raised/50 transition-colors duration-100">
              {columns.map(col => {
                const val = row[String(col.key)]
                return (
                  <td key={String(col.key)} className={cn('px-5 py-3 text-text-primary', col.className)}>
                    {col.render ? col.render(val, row) : String(val ?? '—')}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="border-t border-border px-5 py-3 flex items-center justify-between text-xs text-text-muted">
          <span>Page {page + 1} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded-lg bg-surface-raised border border-border disabled:opacity-40 hover:border-border-bright transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 rounded-lg bg-surface-raised border border-border disabled:opacity-40 hover:border-border-bright transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
