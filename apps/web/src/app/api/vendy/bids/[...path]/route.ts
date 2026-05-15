import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase-admin'

// Never let the CDN cache authenticated proxy responses
export const dynamic = 'force-dynamic'

const BID_GENERATOR_URL = process.env.BID_GENERATOR_URL ?? 'http://localhost:8090'

// Internal service shared secret — the bid-generator trusts requests carrying this header.
// Keeps internal traffic authenticated without needing a full JWT round-trip.
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? 'oakley-internal-dev'

async function proxyToBidGenerator(req: NextRequest, params: { path: string[] }): Promise<NextResponse> {
  const sessionCookie = req.cookies.get('session')?.value
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let decoded
  try {
    decoded = await adminAuth.verifySessionCookie(sessionCookie, false)
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const role = (decoded as Record<string, unknown>)['role'] as string ?? 'staff'
  const path = params.path.join('/')
  const search = req.nextUrl.search
  const upstreamUrl = `${BID_GENERATOR_URL}/${path}${search}`

  // Pass verified user identity as trusted headers — the Next.js layer is the auth boundary.
  // The bid-generator trusts these headers when the internal secret is present.
  const headers: Record<string, string> = {
    'X-User-Email': decoded.email ?? '',
    'X-User-Role': role,
    'X-Internal-Secret': INTERNAL_SERVICE_SECRET,
  }

  const isFormData = req.headers.get('content-type')?.includes('multipart/form-data')
  let body: BodyInit | null = null

  if (!['GET', 'HEAD'].includes(req.method)) {
    body = isFormData ? await req.blob() : await req.text()
    if (!isFormData) {
      headers['Content-Type'] = 'application/json'
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, { method: req.method, headers, body })
  } catch (err) {
    console.error('[proxy] connection error:', err)
    const hint = process.env.NODE_ENV === 'development'
      ? 'Bid generator is not running. Open a new terminal and run: bash start-dev.sh (from the services/bid-generator directory)'
      : 'Upstream service unavailable'
    return NextResponse.json({ detail: hint }, { status: 502 })
  }

  // Forward the response — handle both JSON and plain-text bodies
  const contentType = upstream.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const data = await upstream.json()
      return NextResponse.json(data, { status: upstream.status })
    } catch {
      return NextResponse.json(
        { detail: `Upstream returned malformed JSON (status ${upstream.status})` },
        { status: 502 },
      )
    }
  }

  // Non-JSON (plain text, HTML error pages, etc.) — wrap so the client always gets JSON
  const text = await upstream.text()
  return NextResponse.json(
    { detail: text || upstream.statusText },
    { status: upstream.status },
  )
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToBidGenerator(req, await params)
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToBidGenerator(req, await params)
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToBidGenerator(req, await params)
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToBidGenerator(req, await params)
}
