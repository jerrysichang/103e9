/**
 * Storage layer — LocalStorage + Firebase Firestore sync.
 *
 * All writes go to localStorage immediately (fast) and then sync to Firestore.
 * When remote changes arrive, localStorage is updated and the app re-renders.
 */

import { syncToCloud } from './firebase-sync.js'

const KEYS = {
  gratitude: 'ps_gratitude_v1',
}

// ─── Re-render hook ──────────────────────────────────────────────────────

let _onRemoteUpdate = null

/**
 * Register a callback for when remote data arrives.
 * The app shell calls this so it can re-render.
 */
export function onRemoteUpdate(fn) {
  _onRemoteUpdate = fn
}

/**
 * Called by firebase-sync when remote data arrives.
 */
export function handleRemoteData(items) {
  localStorage.setItem(KEYS.gratitude, JSON.stringify(items))
  if (_onRemoteUpdate) _onRemoteUpdate()
}

// ─── Gratitude Storage ────────────────────────────────────────────────────

export const gratitudeStorage = {
  /** @returns {GratitudeItem[]} */
  getAll() {
    try {
      const raw = localStorage.getItem(KEYS.gratitude)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  },

  /** @param {GratitudeItem[]} items */
  _saveAll(items) {
    localStorage.setItem(KEYS.gratitude, JSON.stringify(items))
    // Fire-and-forget sync to cloud
    syncToCloud(items)
  },

  /** @param {string} title @returns {GratitudeItem} */
  create(title) {
    const items = this.getAll()
    const pursuing = items.filter(i => !i.achieved)
    const item = {
      id: crypto.randomUUID(),
      title: title.trim(),
      achieved: false,
      order: pursuing.length,
      createdAt: new Date().toISOString(),
      achievedAt: null,
      answers: {},
    }
    items.push(item)
    this._saveAll(items)
    return item
  },

  /** @param {string} id @param {Partial<GratitudeItem>} patch @returns {GratitudeItem} */
  update(id, patch) {
    const items = this.getAll()
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1) throw new Error(`Item ${id} not found`)
    items[idx] = { ...items[idx], ...patch }
    this._saveAll(items)
    return items[idx]
  },

  /** @param {string} id @param {string} promptKey @param {string} answer */
  updateAnswer(id, promptKey, answer) {
    const items = this.getAll()
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1) return
    items[idx].answers = { ...items[idx].answers, [promptKey]: answer }
    this._saveAll(items)
  },

  /** @param {string} id @param {boolean} achieved */
  setAchieved(id, achieved) {
    const items = this.getAll()
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1) return
    items[idx].achieved = achieved
    items[idx].achievedAt = achieved ? new Date().toISOString() : null
    const section = items.filter(i => i.achieved === achieved)
    section.forEach((item, i) => { item.order = i })
    this._saveAll(items)
  },

  /** @param {string} id */
  delete(id) {
    const items = this.getAll().filter(i => i.id !== id)
    this._saveAll(items)
  },

  /**
   * Reorder items within a section.
   * @param {string[]} orderedIds - IDs in new order
   * @param {boolean} achieved    - which section
   */
  reorder(orderedIds, achieved) {
    const items = this.getAll()
    orderedIds.forEach((id, idx) => {
      const item = items.find(i => i.id === id)
      if (item && item.achieved === achieved) item.order = idx
    })
    this._saveAll(items)
  },

  /** @param {string} id @returns {GratitudeItem|undefined} */
  getById(id) {
    return this.getAll().find(i => i.id === id)
  },
}

/**
 * @typedef {Object} GratitudeItem
 * @property {string}      id
 * @property {string}      title
 * @property {boolean}     achieved
 * @property {number}      order
 * @property {string}      createdAt
 * @property {string|null} achievedAt
 * @property {Object}      answers   - keyed by prompt key
 */
