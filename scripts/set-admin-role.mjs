/**
 * One-time bootstrap: promotes elizabeth@oakleyhomebuilders.com to admin.
 *
 * Run from the repo root:
 *   node scripts/set-admin-role.mjs
 *
 * Requires: apps/web/.env.local must contain FIREBASE_ADMIN_* vars.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(__dirname, '../apps/web/.env.local')
const envLines = readFileSync(envPath, 'utf8').split('\n')
const env = {}
for (const line of envLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx === -1) continue
  const key = trimmed.slice(0, idx).trim()
  let val = trimmed.slice(idx + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  env[key] = val
}

const projectId = env['FIREBASE_ADMIN_PROJECT_ID']
const clientEmail = env['FIREBASE_ADMIN_CLIENT_EMAIL']
const privateKey = env['FIREBASE_ADMIN_PRIVATE_KEY']?.replace(/\\n/g, '\n')

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_ADMIN_* vars in apps/web/.env.local')
  process.exit(1)
}

// ── Init Firebase Admin ──────────────────────────────────────────────────────
initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
})

const auth = getAuth()
const TARGET_EMAIL = 'elizabeth@oakleyhomebuilders.com'

async function run() {
  console.log(`Looking up user: ${TARGET_EMAIL}`)
  let user
  try {
    user = await auth.getUserByEmail(TARGET_EMAIL)
  } catch (err) {
    console.error(`User not found: ${err.message}`)
    console.error('Make sure Izzy has signed in at least once via Google SSO.')
    process.exit(1)
  }

  console.log(`Found user: uid=${user.uid}`)
  console.log(`Current claims: ${JSON.stringify(user.customClaims)}`)

  await auth.setCustomUserClaims(user.uid, { role: 'admin' })
  console.log(`✓ Role set to admin for ${TARGET_EMAIL}`)
  console.log('Sign out and sign back in on oakleyapps.com to pick up the new role.')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
