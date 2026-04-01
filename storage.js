/**
 * Storage layer — LocalStorage adapter.
 *
 * To add cross-device sync with Supabase (free tier):
 *  1. Create a project at supabase.com
 *  2. Run this SQL:
 *       create table gratitude_items (
 *         id text primary key,
 *         data jsonb not null,
 *         updated_at timestamptz default now()
 *       );
 *  3. Replace the methods below to call the Supabase JS client instead.
 *  4. The method signatures stay the same — no changes needed in gratitude.js.
 *
 * Supabase is free for personal use (500 MB DB, 50k monthly active users).
 */

const KEYS = {
  gratitude: 'ps_gratitude_v1',
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
    // Re-number order within new section
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
