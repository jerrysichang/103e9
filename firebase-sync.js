/**
 * Firebase Sync — passphrase-based cross-device sync via Firestore.
 *
 * How it works:
 *  1. User enters a secret passphrase
 *  2. Passphrase is SHA-256 hashed → becomes the Firestore document ID
 *  3. All data lives at `vaults/{hash}` in Firestore
 *  4. Real-time listener keeps all devices in sync
 *  5. Falls back to localStorage when offline
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js'
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js'

// ─── Firebase Config ──────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyDsJJBwUiwAi2WXzVjJaIYS0JceOrro274",
  authDomain: "e9-fcdaf.firebaseapp.com",
  projectId: "e9-fcdaf",
  storageBucket: "e9-fcdaf.firebasestorage.app",
  messagingSenderId: "966233161319",
  appId: "1:966233161319:web:2c6eca55e7ad5f34b05ec2",
  measurementId: "G-6Y66RYDL5F"
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

// ─── State ────────────────────────────────────────────────────────────────

let vaultHash = null
let unsubscribe = null
let onDataChange = null  // callback when remote data arrives

const PASSPHRASE_KEY = 'ps_sync_passphrase'
const LOCAL_DATA_KEY = 'ps_gratitude_v1'

// ─── Hash ─────────────────────────────────────────────────────────────────

async function hashPassphrase(passphrase) {
  const encoder = new TextEncoder()
  const data = encoder.encode(passphrase.trim().toLowerCase())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Check if user has a stored passphrase.
 */
export function hasPassphrase() {
  return !!localStorage.getItem(PASSPHRASE_KEY)
}

/**
 * Get stored passphrase.
 */
export function getPassphrase() {
  return localStorage.getItem(PASSPHRASE_KEY) || ''
}

/**
 * Connect to Firestore with a passphrase.
 * @param {string} passphrase
 * @param {Function} onChange - called with full data object when remote changes arrive
 */
export async function connect(passphrase, onChange) {
  // Store passphrase locally
  localStorage.setItem(PASSPHRASE_KEY, passphrase)

  vaultHash = await hashPassphrase(passphrase)
  onDataChange = onChange

  // Stop previous listener if any
  if (unsubscribe) unsubscribe()

  const vaultRef = doc(db, 'vaults', vaultHash)

  // Check if vault exists; if not, push local data up
  try {
    const snap = await getDoc(vaultRef)
    if (!snap.exists()) {
      // First time — push local data to cloud
      const localData = localStorage.getItem(LOCAL_DATA_KEY)
      const items = localData ? JSON.parse(localData) : []
      await setDoc(vaultRef, { gratitude: items, updatedAt: Date.now() })
    } else {
      // Vault exists — load profile if present on this device for the first time
      const data = snap.data()
      if (data.profile && !localStorage.getItem('ps_profile_v1')) {
        localStorage.setItem('ps_profile_v1', JSON.stringify(data.profile))
      }
    }
  } catch (err) {
    console.warn('Firebase initial sync failed, using local data:', err)
  }

  // Listen for real-time updates
  unsubscribe = onSnapshot(vaultRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data()
      const items = data.gratitude || []
      // Update local cache
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(items))
      // Notify app
      if (onDataChange) onDataChange(items)
    }
  }, (err) => {
    console.warn('Firestore listener error:', err)
  })
}

/**
 * Save data to Firestore + localStorage.
 * @param {Array} items - full gratitude items array
 */
export async function syncToCloud(items) {
  // Always save locally first
  localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(items))

  if (!vaultHash) return

  try {
    const vaultRef = doc(db, 'vaults', vaultHash)
    await setDoc(vaultRef, { gratitude: items, updatedAt: Date.now() })
  } catch (err) {
    console.warn('Failed to sync to cloud:', err)
  }
}

/**
 * Save profile to Firestore using merge so gratitude data is preserved.
 * @param {Object} profile
 */
export async function syncProfileToCloud(profile) {
  if (!vaultHash) return

  try {
    const vaultRef = doc(db, 'vaults', vaultHash)
    await setDoc(vaultRef, { profile, updatedAt: Date.now() }, { merge: true })
  } catch (err) {
    console.warn('Failed to sync profile to cloud:', err)
  }
}

/**
 * Disconnect listener and clear passphrase.
 */
export function disconnect() {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  vaultHash = null
  localStorage.removeItem(PASSPHRASE_KEY)
}
