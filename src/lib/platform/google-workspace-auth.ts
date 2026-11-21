'use client'

import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth'
import firebaseConfig from '../../../firebase-applet-config.json'

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/calendar.events',
] as const

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
const auth = getAuth(app)

const provider = new GoogleAuthProvider()
for (const scope of GOOGLE_WORKSPACE_SCOPES) {
  provider.addScope(scope)
}

// Keep OAuth access token strictly in memory — never persist to localStorage or sessionStorage.
let isSigningIn = false
let cachedAccessToken: string | null = null
let cachedUser: User | null = null

export interface GoogleWorkspaceUserProfile {
  uid: string
  displayName: string | null
  email: string | null
  photoURL: string | null
}

function toProfile(user: User): GoogleWorkspaceUserProfile {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  }
}

export function initGoogleWorkspaceAuth(
  onAuthSuccess?: (profile: GoogleWorkspaceUserProfile, token: string) => void,
  onAuthCleared?: () => void
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      cachedUser = user
      if (cachedAccessToken) {
        onAuthSuccess?.(toProfile(user), cachedAccessToken)
      } else if (!isSigningIn) {
        cachedAccessToken = null
        onAuthCleared?.()
      }
    } else {
      cachedUser = null
      cachedAccessToken = null
      onAuthCleared?.()
    }
  })
}

export async function signInGoogleWorkspace(): Promise<{
  profile: GoogleWorkspaceUserProfile
  accessToken: string
}> {
  try {
    isSigningIn = true
    const result = await signInWithPopup(auth, provider)
    const credential = GoogleAuthProvider.credentialFromResult(result)
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Workspace access token from sign-in.')
    }
    cachedUser = result.user
    cachedAccessToken = credential.accessToken
    return {
      profile: toProfile(result.user),
      accessToken: cachedAccessToken,
    }
  } finally {
    isSigningIn = false
  }
}

export async function signOutGoogleWorkspace(): Promise<void> {
  await auth.signOut()
  cachedUser = null
  cachedAccessToken = null
}

export function getGoogleWorkspaceToken(): string | null {
  return cachedAccessToken
}

export function getGoogleWorkspaceUser(): GoogleWorkspaceUserProfile | null {
  return cachedUser ? toProfile(cachedUser) : null
}
