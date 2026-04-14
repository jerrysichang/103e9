/**
 * Diet tracker — goals, per-day food entries, optional Firestore sync.
 * Cloud payload omits image data URLs to stay under Firestore size limits.
 */

const STORAGE_KEY = 'ps_diet_v1'

/** @returns {DietState} */
function defaultState() {
  return {
    goals: {
      calories: 2000,
      proteinG: 150,
      carbsG: 200,
      fatG: 65,
    },
    days: {},
  }
}

/** @param {unknown} raw */
function normalizeState(raw) {
  const base = defaultState()
  if (!raw || typeof raw !== 'object') return base
  const o = /** @type {Record<string, unknown>} */ (raw)
  const g = o.goals && typeof o.goals === 'object' ? /** @type {Record<string, unknown>} */ (o.goals) : {}
  const goals = {
    calories: Math.max(0, Number(g.calories) || base.goals.calories),
    proteinG: Math.max(0, Number(g.proteinG) || base.goals.proteinG),
    carbsG: Math.max(0, Number(g.carbsG) || base.goals.carbsG),
    fatG: Math.max(0, Number(g.fatG) || base.goals.fatG),
  }
  const days = {}
  const daysRaw = o.days && typeof o.days === 'object' ? /** @type {Record<string, unknown>} */ (o.days) : {}
  for (const [k, v] of Object.entries(daysRaw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue
    const day = v && typeof v === 'object' ? /** @type {Record<string, unknown>} */ (v) : {}
    const entries = Array.isArray(day.entries) ? day.entries.filter(isEntryLike).map(normalizeEntry) : []
    days[k] = { entries }
  }
  return { goals, days }
}

function isEntryLike(e) {
  return e && typeof e === 'object' && typeof /** @type {{id?:unknown}} */ (e).id === 'string'
}

/** @param {object} e */
function normalizeEntry(e) {
  const x = /** @type {Record<string, unknown>} */ (e)
  const analysis = x.analysis && typeof x.analysis === 'object'
    ? /** @type {Record<string, unknown>} */ (x.analysis)
    : {}
  return {
    id: String(x.id),
    loggedAt: typeof x.loggedAt === 'string' ? x.loggedAt : new Date().toISOString(),
    description: typeof x.description === 'string' ? x.description : '',
    imageDataUrl: typeof x.imageDataUrl === 'string' ? x.imageDataUrl : undefined,
    analysis: {
      calories: Math.max(0, Number(analysis.calories) || 0),
      proteinG: Math.max(0, Number(analysis.proteinG) || 0),
      carbsG: Math.max(0, Number(analysis.carbsG) || 0),
      fatG: Math.max(0, Number(analysis.fatG) || 0),
      summary: typeof analysis.summary === 'string' ? analysis.summary : '',
    },
  }
}

export function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeState(raw ? JSON.parse(raw) : null)
  } catch {
    return defaultState()
  }
}

/** @param {DietState} state */
export function save(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  scheduleCloudSync()
}

function scheduleCloudSync() {
  const stripped = stripForCloud(load())
  import('./firebase-sync.js').then(m => {
    if (m.syncDietToCloud) m.syncDietToCloud(stripped)
  }).catch(() => {})
}

/** @param {DietState} state */
export function stripForCloud(state) {
  const days = {}
  for (const [dateKey, day] of Object.entries(state.days)) {
    days[dateKey] = {
      entries: day.entries.map(({ id, loggedAt, description, analysis }) => ({
        id,
        loggedAt,
        description,
        analysis,
      })),
    }
  }
  return { goals: state.goals, days }
}

/**
 * Merge remote diet into local storage, preserving imageDataUrl for matching entry ids.
 * @param {unknown} remoteRaw
 */
export function applyRemoteDiet(remoteRaw) {
  const remote = normalizeState(remoteRaw)
  const local = load()
  const merged = mergePreservingImages(local, remote)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
}

/** @param {DietState} local @param {DietState} remote */
function mergePreservingImages(local, remote) {
  const goals = remote.goals
  const days = { ...local.days }

  for (const [dateKey, remoteDay] of Object.entries(remote.days)) {
    const localDay = local.days[dateKey] || { entries: [] }
    const imgById = new Map(
      localDay.entries.filter(e => e.imageDataUrl).map(e => [e.id, e.imageDataUrl]),
    )
    const mergedEntries = remoteDay.entries.map(e => ({
      ...e,
      imageDataUrl: imgById.get(e.id) || e.imageDataUrl,
    }))
    const remoteIds = new Set(remoteDay.entries.map(e => e.id))
    const orphanLocal = localDay.entries.filter(e => !remoteIds.has(e.id))
    days[dateKey] = { entries: [...mergedEntries, ...orphanLocal] }
  }

  return { goals, days }
}

/** For first-time vault upload — same shape as cloud. */
export function getDietForInitialVault() {
  return stripForCloud(load())
}

/** @param {string} dateKey @returns {DietDay} */
export function getDay(dateKey) {
  const state = load()
  return state.days[dateKey] || { entries: [] }
}

/** @param {string} dateKey @param {DietFoodEntry} entry */
export function addEntry(dateKey, entry) {
  const state = load()
  const day = state.days[dateKey] || { entries: [] }
  state.days[dateKey] = { entries: [entry, ...day.entries] }
  save(state)
}

/**
 * @param {string} dateKey
 * @param {string} entryId
 */
export function removeEntry(dateKey, entryId) {
  const state = load()
  const day = state.days[dateKey]
  if (!day) return
  day.entries = day.entries.filter(e => e.id !== entryId)
  if (day.entries.length === 0) delete state.days[dateKey]
  save(state)
}

/** @param {Partial<DietGoals>} patch */
export function setGoals(patch) {
  const state = load()
  state.goals = { ...state.goals, ...patch }
  save(state)
}

/** @param {string} dateKey @param {DietGoals} goals */
export function dayTotals(dateKey, goals) {
  const day = getDay(dateKey)
  const t = day.entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.analysis.calories,
      proteinG: acc.proteinG + e.analysis.proteinG,
      carbsG: acc.carbsG + e.analysis.carbsG,
      fatG: acc.fatG + e.analysis.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )
  return {
    consumed: t,
    goals,
    pct: {
      calories: goals.calories ? Math.min(100, (t.calories / goals.calories) * 100) : 0,
      proteinG: goals.proteinG ? Math.min(100, (t.proteinG / goals.proteinG) * 100) : 0,
      carbsG: goals.carbsG ? Math.min(100, (t.carbsG / goals.carbsG) * 100) : 0,
      fatG: goals.fatG ? Math.min(100, (t.fatG / goals.fatG) * 100) : 0,
    },
  }
}

/**
 * @typedef {Object} DietGoals
 * @property {number} calories
 * @property {number} proteinG
 * @property {number} carbsG
 * @property {number} fatG
 */

/**
 * @typedef {Object} DietAnalysis
 * @property {number} calories
 * @property {number} proteinG
 * @property {number} carbsG
 * @property {number} fatG
 * @property {string} summary
 */

/**
 * @typedef {Object} DietFoodEntry
 * @property {string} id
 * @property {string} loggedAt
 * @property {string} description
 * @property {string} [imageDataUrl]
 * @property {DietAnalysis} analysis
 */

/**
 * @typedef {Object} DietDay
 * @property {DietFoodEntry[]} entries
 */

/**
 * @typedef {Object} DietState
 * @property {DietGoals} goals
 * @property {Record<string, DietDay>} days
 */
