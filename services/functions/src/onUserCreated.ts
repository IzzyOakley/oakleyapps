import * as admin from 'firebase-admin'
import { auth } from 'firebase-functions/v2'

if (admin.apps.length === 0) {
  admin.initializeApp()
}

export const onUserCreated = auth.user().onCreate(async (user) => {
  await admin.auth().setCustomUserClaims(user.uid, { role: 'staff' })
  console.log(`Set default role 'staff' for new user: ${user.uid} (${user.email})`)
})
