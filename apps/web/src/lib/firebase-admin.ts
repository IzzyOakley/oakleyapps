import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0]

  // Local dev: use explicit service account credentials from .env.local
  // Production (Firebase App Hosting / Cloud Run): use Application Default Credentials —
  // no private key needed; the runtime service account has the required Firebase Auth permissions.
  if (process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID ?? 'oakley-apps',
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    })
  }

  // Application Default Credentials — works automatically on GCP
  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID ?? 'oakley-apps',
  })
}

export const adminAuth = getAuth(getAdminApp())
