import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../shared/components/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Page structure ──────────────────────────────────────────────────
        background:      '#EAEAED', // Main content area
        surface:         '#FFFFFF', // Cards, modals, tables, inputs
        'surface-raised':'#FAFAFA', // Table headers, section footers
        sidebar:         '#18151F', // Sidebar background
        'sidebar-active':'#221E30', // Active nav item background

        // ── Borders ─────────────────────────────────────────────────────────
        border:          '#E6E6E8', // Card borders, table dividers
        'border-bright': '#D0D0D5', // Hover / focus border state
        'border-light':  '#F0F0F2', // Row dividers inside cards

        // ── Brand / interactive ──────────────────────────────────────────────
        primary:         '#7C3AED', // Primary actions, active nav, labels
        'primary-hover': '#6D28D9', // Button hover
        'primary-light': '#F3F0FF', // Badge bg, AI card tint
        'primary-mid':   '#A78BFA', // Secondary violet elements
        'primary-dark':  '#5B21B6', // Dark violet text on light bg
        secondary:       '#A78BFA', // Alias for gradient use

        // ── Sidebar nav text ─────────────────────────────────────────────────
        'nav-inactive':  '#8B83A8',
        'nav-active':    '#C4B5FD',

        // ── Text ─────────────────────────────────────────────────────────────
        'text-primary':  '#111111',
        'text-secondary':'#6B7280',
        'text-muted':    '#AAAAAA',

        // ── Semantic status ───────────────────────────────────────────────────
        success:         '#15803D',
        'success-bg':    '#ECFDF5',
        warning:         '#B45309',
        'warning-bg':    '#FFFBEB',
        error:           '#DC2626',
        'error-bg':      '#FEF2F2',
        danger:          '#DC2626',
        'danger-bg':     '#FEF2F2',
        info:            '#1D4ED8',
        'info-bg':       '#EFF6FF',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      borderRadius: {
        card: '14px',
      },
      animation: {
        'fade-in': 'fadeIn 150ms ease-out',
        shimmer: 'shimmer 2s infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        glow: '0 8px 32px rgba(124,58,237,0.10)',
      },
    },
  },
  plugins: [],
}

export default config
