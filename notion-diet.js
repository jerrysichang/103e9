/**
 * Pulls the day's food log + targets that Claude writes to Notion (J-OS Diet),
 * via the notion-worker.js Cloudflare Worker. Read-only: Notion stays the source.
 */

// Deployed notion-worker.js (Cloudflare worker: diet-notion).
export const NOTION_WORKER_URL = 'https://diet-notion.jerry-si-chang.workers.dev'

const KEY_STORAGE = 'diet_notion_key'
const STALE_MS = 30_000

/** @type {Record<string, { at: number, data: NotionDay | null, error?: string }>} */
const cache = {}
/** @type {Record<string, Promise<void> | undefined>} */
const inflight = {}

export function getNotionKey() {
  try { return localStorage.getItem(KEY_STORAGE) || '' } catch { return '' }
}

export function setNotionKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {}
  for (const k of Object.keys(cache)) delete cache[k]
}

/** Last fetched data for a day (or null). Never blocks. */
export function getNotionDay(dateKey) {
  return cache[dateKey]?.data || null
}

export function getNotionError(dateKey) {
  return cache[dateKey]?.error || ''
}

/**
 * Fetch the day if stale. Calls onUpdate() when new data lands.
 * @param {string} dateKey
 * @param {() => void} onUpdate
 * @param {{ force?: boolean }} [opts]
 */
export function refreshNotionDay(dateKey, onUpdate, opts = {}) {
  const key = getNotionKey()
  if (!key || !NOTION_WORKER_URL) return
  const c = cache[dateKey]
  if (!opts.force && c && Date.now() - c.at < STALE_MS) return
  if (inflight[dateKey]) return

  inflight[dateKey] = (async () => {
    try {
      const res = await fetch(`${NOTION_WORKER_URL}/diet?date=${dateKey}${opts.force ? '&fresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (!res.ok) throw new Error(res.status === 401 ? 'Notion key rejected' : `Notion sync failed (${res.status})`)
      const data = await res.json()
      const prev = JSON.stringify(cache[dateKey]?.data || null)
      cache[dateKey] = { at: Date.now(), data }
      if (JSON.stringify(data) !== prev) onUpdate()
    } catch (err) {
      const hadError = cache[dateKey]?.error
      cache[dateKey] = { at: Date.now(), data: cache[dateKey]?.data || null, error: String(err.message || err) }
      if (!hadError) onUpdate()
    } finally {
      inflight[dateKey] = undefined
    }
  })()
}

/**
 * @typedef {Object} NotionDay
 * @property {string} date
 * @property {null | { dayType: string, calories: number, proteinG: number, carbsG: number, fatG: number }} targets
 * @property {Array<{ id: string, loggedAt: string, description: string, source: 'notion', meal: string, analysis: { summary: string, calories: number, proteinG: number, carbsG: number, fatG: number } }>} entries
 */
