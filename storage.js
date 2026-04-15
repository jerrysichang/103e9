/**
 * Storage layer — LocalStorage + Firebase Firestore sync.
 *
 * All writes go to localStorage immediately (fast) and then sync to Firestore.
 * When remote changes arrive, localStorage is updated and the app re-renders.
 */

import { syncToCloud, syncIssuesToCloud } from './firebase-sync.js'
import { applyRemoteDiet } from './diet-storage.js'

const KEYS = {
  gratitude: 'ps_gratitude_v1',
  issues: 'ps_issues_v1',
}

// ─── Re-render hook ──────────────────────────────────────────────────────

let _onRemoteUpdate = null
let _suppressRemoteUpdate = false

/**
 * Register a callback for when remote data arrives.
 * The app shell calls this so it can re-render.
 */
export function onRemoteUpdate(fn) {
  _onRemoteUpdate = fn
}

/**
 * Called by firebase-sync when remote vault data arrives.
 * @param {object|Array} vaultData - full Firestore document fields, or legacy gratitude array
 */
export function handleRemoteData(vaultData) {
  if (Array.isArray(vaultData)) {
    localStorage.setItem(KEYS.gratitude, JSON.stringify(vaultData))
  } else if (vaultData && typeof vaultData === 'object') {
    const data = /** @type {Record<string, unknown>} */ (vaultData)
    if (Array.isArray(data.gratitude)) {
      localStorage.setItem(KEYS.gratitude, JSON.stringify(data.gratitude))
    }
    if (data.diet !== undefined) {
      applyRemoteDiet(data.diet)
    }
    if (Array.isArray(data.issues)) {
      localStorage.setItem(KEYS.issues, JSON.stringify(data.issues))
    }
  }
  if (_onRemoteUpdate && !_suppressRemoteUpdate) _onRemoteUpdate()
}

/**
 * Temporarily suppress remote-update re-renders (e.g. during drag reorder).
 */
export function suppressRemoteRender(ms = 1500) {
  _suppressRemoteUpdate = true
  setTimeout(() => { _suppressRemoteUpdate = false }, ms)
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
      promptEntries: {},
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
    const item = items[idx]
    const now = new Date().toISOString()
    const text = String(answer ?? '')
    const existing = this.getPromptEntries(item, promptKey)

    if (!text.trim()) {
      item.answers = { ...(item.answers || {}), [promptKey]: '' }
      item.promptEntries = { ...(item.promptEntries || {}), [promptKey]: [] }
      this._saveAll(items)
      return
    }

    if (existing.length === 0) {
      const entry = {
        id: crypto.randomUUID(),
        text,
        createdAt: now,
        updatedAt: now,
      }
      item.promptEntries = { ...(item.promptEntries || {}), [promptKey]: [entry] }
    } else {
      const [first, ...rest] = existing
      const updated = { ...first, text, updatedAt: now }
      item.promptEntries = { ...(item.promptEntries || {}), [promptKey]: [updated, ...rest] }
    }
    item.answers = { ...(item.answers || {}), [promptKey]: text }
    this._saveAll(items)
  },

  /**
   * Get normalized prompt entries for rendering/editing.
   * Falls back to legacy single-answer data.
   * @param {GratitudeItem} item
   * @param {string} promptKey
   * @returns {PromptEntry[]}
   */
  getPromptEntries(item, promptKey) {
    const list = item?.promptEntries?.[promptKey]
    if (Array.isArray(list) && list.length > 0) {
      return list.map(entry => ({
        id: entry.id || crypto.randomUUID(),
        text: String(entry.text || ''),
        createdAt: entry.createdAt || item.createdAt || new Date().toISOString(),
        updatedAt: entry.updatedAt || entry.createdAt || item.createdAt || new Date().toISOString(),
      }))
    }

    const legacy = String(item?.answers?.[promptKey] || '')
    if (!legacy.trim()) return []
    const when = item?.createdAt || new Date().toISOString()
    return [{
      id: crypto.randomUUID(),
      text: legacy,
      createdAt: when,
      updatedAt: when,
    }]
  },

  /** @param {string} id @param {string} promptKey @returns {PromptEntry|null} */
  addPromptEntry(id, promptKey) {
    const items = this.getAll()
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1) return null
    const now = new Date().toISOString()
    const entry = { id: crypto.randomUUID(), text: '', createdAt: now, updatedAt: now }
    const item = items[idx]
    const existing = this.getPromptEntries(item, promptKey)
    item.promptEntries = { ...(item.promptEntries || {}), [promptKey]: [...existing, entry] }
    this._saveAll(items)
    return entry
  },

  /** @param {string} id @param {string} promptKey @param {string} entryId @param {string} text */
  updatePromptEntry(id, promptKey, entryId, text) {
    const items = this.getAll()
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1) return
    const item = items[idx]
    const existing = this.getPromptEntries(item, promptKey)
    const now = new Date().toISOString()
    let matched = false
    const next = existing.map(entry => {
      if (entry.id !== entryId) return entry
      matched = true
      return { ...entry, text: String(text ?? ''), updatedAt: now }
    })

    if (!matched) {
      if (next.length > 0) {
        next[0] = { ...next[0], text: String(text ?? ''), updatedAt: now }
      } else {
        next.push({
          id: entryId || crypto.randomUUID(),
          text: String(text ?? ''),
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    item.promptEntries = { ...(item.promptEntries || {}), [promptKey]: next }
    this._saveAll(items)
  },

  /** @param {string} id @param {string} promptKey @param {string} entryId */
  deletePromptEntry(id, promptKey, entryId) {
    const items = this.getAll()
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1) return
    const item = items[idx]
    const existing = this.getPromptEntries(item, promptKey)
    const next = existing.filter(entry => entry.id !== entryId)
    item.promptEntries = { ...(item.promptEntries || {}), [promptKey]: next }
    if (next.length === 0) {
      item.answers = { ...(item.answers || {}), [promptKey]: '' }
    } else {
      item.answers = { ...(item.answers || {}), [promptKey]: next[0].text }
    }
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

// ─── Issues Storage ───────────────────────────────────────────────────────

export const issueStorage = {
  /** @returns {IssueItem[]} */
  getAll() {
    try {
      const raw = localStorage.getItem(KEYS.issues)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  },

  /** @param {IssueItem[]} items */
  _saveAll(items) {
    localStorage.setItem(KEYS.issues, JSON.stringify(items))
    syncIssuesToCloud(items)
  },

  /** @param {string} text @returns {IssueItem} */
  create(text) {
    const items = this.getAll()
    const now = new Date().toISOString()
    const issue = {
      id: crypto.randomUUID(),
      text: text.trim(),
      completed: false,
      order: items.filter(item => !item.completed).length,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }
    items.push(issue)
    this._saveAll(items)
    return issue
  },

  /** @param {string} id @param {boolean} completed */
  setCompleted(id, completed) {
    const items = this.getAll()
    const idx = items.findIndex(item => item.id === id)
    if (idx === -1) return
    const now = new Date().toISOString()
    items[idx].completed = completed
    items[idx].completedAt = completed ? now : null
    items[idx].updatedAt = now

    const section = items.filter(item => item.completed === completed)
    section.forEach((item, index) => { item.order = index })
    this._saveAll(items)
  },

  /** @param {string} id @param {string} text */
  updateText(id, text) {
    const items = this.getAll()
    const idx = items.findIndex(item => item.id === id)
    if (idx === -1) return
    items[idx].text = String(text || '').trim()
    items[idx].updatedAt = new Date().toISOString()
    this._saveAll(items)
  },

  /** @param {string} id */
  delete(id) {
    const items = this.getAll().filter(item => item.id !== id)
    this._saveAll(items)
  },

  /**
   * Reorder issues within section.
   * @param {string[]} orderedIds
   * @param {boolean} completed
   */
  reorder(orderedIds, completed) {
    const items = this.getAll()
    orderedIds.forEach((id, idx) => {
      const item = items.find(i => i.id === id)
      if (item && item.completed === completed) item.order = idx
    })
    this._saveAll(items)
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
 * @property {Object}      promptEntries - keyed by prompt key (PromptEntry[])
 */

/**
 * @typedef {Object} PromptEntry
 * @property {string} id
 * @property {string} text
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} IssueItem
 * @property {string} id
 * @property {string} text
 * @property {boolean} completed
 * @property {number} order
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} completedAt
 */
