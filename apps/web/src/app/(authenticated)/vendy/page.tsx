import type { Metadata } from 'next'
import Link from 'next/link'
import { Ruler, FileOutput, GitCompare, ChevronRight } from 'lucide-react'

export const metadata: Metadata = { title: 'Vendy — Oakley Apps' }

const FEATURES = [
  {
    id: 'takeoffs',
    title: 'Takeoffs',
    icon: <Ruler size={22} />,
    description: 'Extract quantities from blueprints. Review, fill gaps, and lock takeoffs for bidding.',
    status: 'active' as const,
    href: '/vendy/takeoffs',
  },
  {
    id: 'bid-generator',
    title: 'Bid Generator',
    icon: <FileOutput size={22} />,
    description: 'Generate reverse bids for each vendor based on takeoff quantities and pricing history.',
    status: 'active' as const,
    href: '/vendy/bids',
  },
  {
    id: 'bid-auditor',
    title: 'Bid Auditor',
    icon: <GitCompare size={22} />,
    description: 'Compare vendor responses against generated bids. Flag discrepancies with supporting data.',
    status: 'coming-soon' as const,
    href: null,
  },
]

export default function VendyPage() {
  return (
    <div className="animate-in fade-in">
      <div className="mb-10">
        <h1 className="text-3xl font-semibold text-text-primary tracking-tight">Vendy</h1>
        <p className="text-base text-text-secondary mt-2">
          Automated bidding for Oakley Home Builders. From blueprints to vendor bids — without the back and forth.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map(feature => (
          <FeatureTile key={feature.id} feature={feature} />
        ))}
      </div>
    </div>
  )
}

interface Feature {
  id: string
  title: string
  icon: React.ReactNode
  description: string
  status: 'active' | 'coming-soon'
  href: string | null
}

function FeatureTile({ feature }: { feature: Feature }) {
  const inner = (
    <div className="bg-surface border border-border rounded-2xl p-6 h-full transition-all duration-200 hover:border-border-bright hover:shadow-lg hover:shadow-indigo-500/10 group">
      <div className="w-11 h-11 rounded-xl bg-surface-raised flex items-center justify-center text-primary">
        {feature.icon}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-text-primary">{feature.title}</h2>
      <p className="mt-1 text-sm text-text-secondary line-clamp-3">{feature.description}</p>
      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
        {feature.status === 'active' ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
            Coming Soon
          </span>
        )}
        {feature.status === 'active' && (
          <ChevronRight size={16} className="text-text-muted transition-transform duration-150 group-hover:translate-x-0.5" />
        )}
      </div>
    </div>
  )

  if (feature.href) {
    return <Link href={feature.href} className="block cursor-pointer">{inner}</Link>
  }

  return (
    <div className="cursor-default" title="In development.">
      {inner}
    </div>
  )
}
