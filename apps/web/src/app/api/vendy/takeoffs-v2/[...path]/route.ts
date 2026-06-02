import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase-admin'

// Never let the CDN cache authenticated proxy responses
export const dynamic = 'force-dynamic'

const TAKEOFF_AGENT_V2_URL = process.env.TAKEOFF_AGENT_V2_URL ?? 'http://localhost:8003'

// Internal service shared secret — takeoff-agent-v2 trusts requests carrying this header.
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? 'oakley-internal-dev'

// Fetch a Google identity token from the GCE metadata server for Cloud Run service-to-service auth.
// Only called in production (https:// URLs). Returns null in local dev or on error.
async function getGoogleIdentityToken(audience: string): Promise<string | null> {
  try {
    const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`
    const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function proxyToTakeoffAgentV2(
  req: NextRequest,
  params: { path: string[] },
): Promise<NextResponse> {
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
  const upstreamUrl = `${TAKEOFF_AGENT_V2_URL}/${path}${search}`

  const headers: Record<string, string> = {
    'X-User-Email': decoded.email ?? '',
    'X-User-Role': role,
    'X-Internal-Secret': INTERNAL_SERVICE_SECRET,
  }

  if (TAKEOFF_AGENT_V2_URL.startsWith('https://')) {
    const idToken = await getGoogleIdentityToken(TAKEOFF_AGENT_V2_URL)
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`
  }

  const reqContentType = req.headers.get('content-type') ?? ''
  const isFormData = reqContentType.includes('multipart/form-data')
  let body: BodyInit | null = null

  if (!['GET', 'HEAD'].includes(req.method)) {
    if (isFormData) {
      body = await req.blob()
      // Must forward the original Content-Type so the multipart boundary is preserved
      headers['Content-Type'] = reqContentType
    } else {
      body = await req.text()
      headers['Content-Type'] = 'application/json'
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, { method: req.method, headers, body })
  } catch (err) {
    console.error('[proxy v2] connection error:', err)
    const hint =
      process.env.NODE_ENV === 'development'
        ? 'Takeoff agent v2 is not running. Open a new terminal and run: bash start-dev.sh (from services/takeoff-agent-v2)'
        : 'Upstream service unavailable'
    return NextResponse.json({ detail: hint }, { status: 502 })
  }

  const NO_CACHE = { 'Cache-Control': 'no-store' }
  const contentType = upstream.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    try {
      const data = await upstream.json()
      return NextResponse.json(data, { status: upstream.status, headers: NO_CACHE })
    } catch {
      return NextResponse.json(
        { detail: `Upstream returned malformed JSON (status ${upstream.status})` },
        { status: 502, headers: NO_CACHE },
      )
    }
  }

  const text = await upstream.text()
  return NextResponse.json(
    { detail: text || upstream.statusText },
    { status: upstream.status, headers: NO_CACHE },
  )
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyToTakeoffAgentV2(req, await params)
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyToTakeoffAgentV2(req, await params)
}
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyToTakeoffAgentV2(req, await params)
}
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyToTakeoffAgentV2(req, await params)
}
