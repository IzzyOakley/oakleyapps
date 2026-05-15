import * as admin from 'firebase-admin'
import { https } from 'firebase-functions/v2'
import { HttpsError } from 'firebase-functions/v2/https'

if (admin.apps.length === 0) {
  admin.initializeApp()
}

type UserRole = 'admin' | 'management' | 'pm' | 'staff' | 'vendor'
const VALID_ROLES: UserRole[] = ['admin', 'management', 'pm', 'staff', 'vendor']

interface SetRoleData {
  uid: string
  role: UserRole
}

export const setUserRole = https.onCall<SetRoleData>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated')
  }

  const callerRole = (request.auth.token as Record<string, unknown>)['role'] as string | undefined
  if (callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can set roles')
  }

  const { uid, role } = request.data

  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'uid is required')
  }

  if (!VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${VALID_ROLES.join(', ')}`)
  }

  await admin.auth().setCustomUserClaims(uid, { role })
  console.log(`Updated role for ${uid} to ${role} by admin ${request.auth.uid}`)

  return { success: true, uid, role }
})
