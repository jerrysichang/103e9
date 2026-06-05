/**
 * Diet tracker — goals, daily log, AI estimates from text and/or photos.
 * Uses the same Cloudflare worker as Coach (Anthropic Messages API).
 */

import {
  load,
  todayKey,
  getDay,
  addEntry,
  removeEntry,
  setGoals,
  dayTotals,
  getFavorites,
  createFavorite,
  updateFavorite,
  deleteFavorite,
} from './diet-storage.js'

// ─── Config (match coach.js worker) ───────────────────────────────────────

const WORKER_URL = 'https://jos.jerry-si-chang.workers.dev'
const DIET_MODEL = 'claude-sonnet-4-20250514'
const OPEN_FOOD_FACTS_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl'

const ANALYSIS_SYSTEM = `You estimate calories and macronutrients for a single eating occasion.

The user may describe food in text, attach a photo of a meal, or both. Use every clue you have. If portions are unclear, make your best reasonable guess and say so briefly in the summary.

Accuracy rules (important):
- If this is a packaged/branded product and a nutrition label is visible or described, prioritize the label over generic estimates.
- Use values for the amount actually consumed (for example: per bottle, per bar, per serving eaten). If the label is per 100g/ml and serving size is known, convert.
- Treat carbs as TOTAL carbohydrate shown on the label. Do not return net carbs and do not subtract fiber or sugar alcohols.
- If the user provides explicit numbers in text/corrections (for example "29g carbs"), those numbers should override your estimate.

Return ONLY valid JSON (no markdown, no code fences) with exactly these keys:
{
  "calories": <number, total kcal>,
  "protein_g": <number, grams>,
  "carbs_g": <number, grams>,
  "fat_g": <number, grams>,
  "summary": <string, one short sentence suitable for a daily log>
}

All numbers must be non-negative. Round calories to the nearest integer, macros to one decimal place if needed.`

// ─── Icons ────────────────────────────────────────────────────────────────

const ICONS = {
  back: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="10 4 6 8 10 12"/>
  </svg>`,
  target: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="8" cy="8" r="5.5"/>
    <circle cx="8" cy="8" r="2"/>
  </svg>`,
}

// ─── AI ───────────────────────────────────────────────────────────────────

/**
 * @param {string} description
 * @param {{ dataUrl: string, mediaType: string, base64: string } | null} image
 */
async function analyzeMeal(description, image) {
  const content = []
  const text = description.trim() || '(No text — infer only from the image.)'
  content.push({ type: 'text', text })

  if (image) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.base64,
      },
    })
  }

  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DIET_MODEL,
      max_tokens: 512,
      system: ANALYSIS_SYSTEM,
      messages: [{ role: 'user', content }],
    }),
  })

  const data = await res.json()
  const raw = data?.content?.[0]?.text || '{}'
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const match = stripped.match(/\{[\s\S]*\}/)
  const parsed = match ? JSON.parse(match[0]) : {}

  return {
    calories: Math.max(0, Math.round(Number(parsed.calories) || 0)),
    proteinG: Math.max(0, Number(parsed.protein_g) || 0),
    carbsG: Math.max(0, Number(parsed.carbs_g) || 0),
    fatG: Math.max(0, Number(parsed.fat_g) || 0),
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'Logged meal',
  }
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function firstNum(obj, keys) {
  for (const key of keys) {
    const n = toNum(obj?.[key])
    if (n !== null) return n
  }
  return null
}

function parseAmountGramsFromText(text) {
  const raw = String(text || '').toLowerCase()
  const unitMatch = raw.match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)/i)
  if (!unitMatch) return null
  const val = Number(unitMatch[1])
  if (!Number.isFinite(val) || val <= 0) return null
  const unit = unitMatch[2].toLowerCase()
  if (unit === 'l' || unit.startsWith('lit')) return val * 1000
  return val
}

function parseAmountGramsFromLabel(text) {
  const raw = String(text || '').toLowerCase()
  const m = raw.match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)/i)
  if (!m) return null
  const val = Number(m[1])
  if (!Number.isFinite(val) || val <= 0) return null
  const unit = m[2].toLowerCase()
  if (unit === 'l' || unit.startsWith('lit')) return val * 1000
  return val
}

function extractOpenFoodFactsAnalysis(product, queryText) {
  const nutriments = product?.nutriments || {}
  const servingProtein = firstNum(nutriments, ['proteins_serving'])
  const servingCarbs = firstNum(nutriments, ['carbohydrates_serving'])
  const servingFat = firstNum(nutriments, ['fat_serving'])
  const servingKcal = firstNum(nutriments, ['energy-kcal_serving', 'energy-kcal_value'])

  let protein = servingProtein
  let carbs = servingCarbs
  let fat = servingFat
  let calories = servingKcal
  let servingHint = ''

  if (protein === null || carbs === null || fat === null) {
    const per100Protein = firstNum(nutriments, ['proteins_100g'])
    const per100Carbs = firstNum(nutriments, ['carbohydrates_100g'])
    const per100Fat = firstNum(nutriments, ['fat_100g'])
    const per100Kcal = firstNum(nutriments, ['energy-kcal_100g'])
    if (per100Protein === null || per100Carbs === null || per100Fat === null) return null
    const amountG =
      parseAmountGramsFromText(queryText) ||
      parseAmountGramsFromLabel(product?.serving_size) ||
      parseAmountGramsFromLabel(product?.quantity) ||
      100
    const factor = amountG / 100
    protein = per100Protein * factor
    carbs = per100Carbs * factor
    fat = per100Fat * factor
    calories = per100Kcal !== null ? per100Kcal * factor : (protein * 4 + carbs * 4 + fat * 9)
    if (!parseAmountGramsFromText(queryText)) servingHint = ` (estimated for ~${Math.round(amountG)}g)`
  }

  return {
    calories: Math.max(0, Math.round(calories || 0)),
    proteinG: Math.max(0, Number((protein || 0).toFixed(1))),
    carbsG: Math.max(0, Number((carbs || 0).toFixed(1))),
    fatG: Math.max(0, Number((fat || 0).toFixed(1))),
    summary: `Matched ${product.product_name || 'packaged food'} from Open Food Facts${servingHint}.`,
  }
}

async function lookupPackagedFoodAnalysis(queryText) {
  const q = String(queryText || '').trim()
  if (!q) return null
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '12',
    fields: 'product_name,brands,serving_size,quantity,nutriments',
  })
  const res = await fetch(`${OPEN_FOOD_FACTS_SEARCH_URL}?${params.toString()}`)
  if (!res.ok) return null
  const data = await res.json()
  const products = Array.isArray(data?.products) ? data.products : []
  if (!products.length) return null

  const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2)
  const scored = products.map((p) => {
    const haystack = `${p?.product_name || ''} ${p?.brands || ''}`.toLowerCase()
    const tokenMatches = tokens.reduce((acc, t) => (haystack.includes(t) ? acc + 1 : acc), 0)
    const hasServing = toNum(p?.nutriments?.proteins_serving) !== null && toNum(p?.nutriments?.carbohydrates_serving) !== null
    const hasPer100 = toNum(p?.nutriments?.proteins_100g) !== null && toNum(p?.nutriments?.carbohydrates_100g) !== null
    const score = tokenMatches * 5 + (hasServing ? 7 : 0) + (hasPer100 ? 3 : 0)
    return { product: p, score }
  }).sort((a, b) => b.score - a.score)

  const top = scored.slice(0, 3).filter(item => item.score >= 8)
  if (!top.length) return null
  const best = top[0]
  const second = top[1]
  const isClearlyBest = best.score >= 14 && (!second || best.score - second.score >= 4)
  if (isClearlyBest) {
    return extractOpenFoodFactsAnalysis(best.product, q)
  }

  // Ambiguous match: ask user to pick so we avoid silently logging wrong macros.
  const optionsText = top.map((item, i) => {
    const p = item.product
    const name = p?.product_name || 'Unknown product'
    const brand = p?.brands ? ` (${p.brands})` : ''
    const serving = p?.serving_size ? `, serving ${p.serving_size}` : ''
    return `${i + 1}) ${name}${brand}${serving}`
  }).join('\n')
  const choice = prompt(
    `Pick the correct packaged-food match:\n${optionsText}\n\nEnter 1-${top.length}, or Cancel to skip and use AI estimate.`,
  )
  if (!choice) return null
  const idx = Number(choice) - 1
  if (!Number.isInteger(idx) || idx < 0 || idx >= top.length) return null
  return extractOpenFoodFactsAnalysis(top[idx].product, q)
}

async function analyzeMealReliable(description, image) {
  const text = String(description || '').trim()
  let packaged = null
  if (text) {
    try {
      packaged = await lookupPackagedFoodAnalysis(text)
    } catch (err) {
      console.warn('Packaged food lookup failed:', err)
    }
  }

  if (packaged && !image) return packaged
  const ai = await analyzeMeal(description, image)
  if (!packaged) return ai
  return {
    ...ai,
    calories: packaged.calories,
    proteinG: packaged.proteinG,
    carbsG: packaged.carbsG,
    fatG: packaged.fatG,
    summary: packaged.summary,
  }
}

/**
 * Parse user-provided macro numbers from free text and apply as hard overrides.
 * This improves reliability for packaged foods where users type label values.
 * @param {string} text
 * @param {{ calories: number, proteinG: number, carbsG: number, fatG: number, summary: string }} analysis
 */
function applyExplicitMacroOverrides(text, analysis) {
  const raw = String(text || '')
  const next = { ...analysis }

  const caloriesMatch = raw.match(/(?:^|[^\w])(kcal|calories?|cals?)\s*[:=-]?\s*(\d{2,4}(?:\.\d+)?)|(\d{2,4}(?:\.\d+)?)\s*(?:kcal|calories?|cals?)(?:[^\w]|$)/i)
  if (caloriesMatch) {
    const cal = Number(caloriesMatch[2] || caloriesMatch[3])
    if (Number.isFinite(cal) && cal >= 0) next.calories = Math.round(cal)
  }

  const proteinMatch = raw.match(/(?:protein|prot(?:ein)?)\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\s*g|(\d{1,3}(?:\.\d+)?)\s*g\s*(?:protein|prot(?:ein)?)/i)
  if (proteinMatch) {
    const p = Number(proteinMatch[1] || proteinMatch[2])
    if (Number.isFinite(p) && p >= 0) next.proteinG = p
  }

  const carbsMatch = raw.match(/(?:total\s+)?(?:carb|carbs|carbohydrate|carbohydrates)\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\s*g|(\d{1,3}(?:\.\d+)?)\s*g\s*(?:total\s+)?(?:carb|carbs|carbohydrate|carbohydrates)/i)
  if (carbsMatch) {
    const c = Number(carbsMatch[1] || carbsMatch[2])
    if (Number.isFinite(c) && c >= 0) next.carbsG = c
  }

  const fatMatch = raw.match(/(?:fat|fats)\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\s*g|(\d{1,3}(?:\.\d+)?)\s*g\s*(?:fat|fats)/i)
  if (fatMatch) {
    const f = Number(fatMatch[1] || fatMatch[2])
    if (Number.isFinite(f) && f >= 0) next.fatG = f
  }

  return next
}

/**
 * @param {File | null} file
 * @returns {Promise<{ dataUrl: string, mediaType: string, base64: string } | null>}
 */
function readImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!m) {
        resolve(null)
        return
      }
      const mediaType = m[1]
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
        resolve(null)
        return
      }
      // Store/send a smaller image payload so saves stay reliable in localStorage.
      compressForLog(dataUrl)
        .then(compact => {
          const mm = compact.match(/^data:([^;]+);base64,(.+)$/)
          if (!mm) {
            resolve({ dataUrl, mediaType, base64: m[2] })
            return
          }
          resolve({ dataUrl: compact, mediaType: mm[1], base64: mm[2] })
        })
        .catch(() => resolve({ dataUrl, mediaType, base64: m[2] }))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Downscale and compress image to reduce storage failures on save.
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
function compressForLog(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const maxDim = 960
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1))
      const w = Math.max(1, Math.round((img.width || 1) * scale))
      const h = Math.max(1, Math.round((img.height || 1) * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.78))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// ─── UI bits ──────────────────────────────────────────────────────────────

function manualMacroRow({ key, label, unit, max, step }) {
  return `
    <div class="diet-manual-row" data-manual-row="${key}">
      <span class="diet-manual-row-label">${label}</span>
      <div class="diet-manual-input-wrap">
        <input
          class="input diet-manual-input"
          id="diet-manual-${key}"
          type="number"
          inputmode="decimal"
          min="0"
          step="${step}"
          value="0"
        />
        ${unit ? `<span class="diet-manual-unit">${unit}</span>` : ''}
      </div>
      <input
        class="diet-manual-slider"
        id="diet-manual-${key}-slider"
        type="range"
        min="0"
        max="${max}"
        step="${step}"
        value="0"
      />
    </div>
  `
}

function macroBar(label, consumed, goal, pct) {
  const over = goal > 0 && consumed > goal
  const overAmount = over ? consumed - goal : 0
  const fillPct = goal > 0 ? Math.min(100, (consumed / goal) * 75) : 0
  return `
    <div class="diet-macro">
      <div class="diet-macro-head">
        <span class="diet-macro-label">${label}</span>
        <span class="diet-macro-values ${over ? 'diet-macro-over' : ''}">
          ${formatVal(label, consumed)} / ${formatVal(label, goal)}${over ? ` (+${formatVal(label, overAmount)})` : ''}
        </span>
      </div>
      <div class="diet-bar-track">
        <span class="diet-target-line" aria-hidden="true"></span>
        <div class="diet-bar-fill ${over ? 'diet-bar-over' : ''}" style="width:${fillPct}%"></div>
      </div>
    </div>
  `
}

function macroRemaining(consumed, goals) {
  return {
    calories: goals.calories - consumed.calories,
    proteinG: goals.proteinG - consumed.proteinG,
    carbsG: goals.carbsG - consumed.carbsG,
    fatG: goals.fatG - consumed.fatG,
  }
}

function formatVal(label, n) {
  if (label === 'Calories') return `${Math.round(n)}`
  return n % 1 === 0 ? `${Math.round(n)}g` : `${n.toFixed(1)}g`
}

// ─── Main tracker view ────────────────────────────────────────────────────

export function renderDietTracker(container, { navigate }) {
  function render() {
    const dateKey = todayKey()
    const state = load()
    const goals = state.goals
    const day = getDay(dateKey)
    const entries = Array.isArray(day?.entries) ? day.entries : []
    const { consumed, pct } = dayTotals(dateKey, goals)

    container.innerHTML = `
      <div class="view" id="view-diet">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-icon menu-grid-btn header-menu-btn" id="btn-diet-back" aria-label="Menu">
              <span class="menu-grid-icon" aria-hidden="true"></span>
            </button>
          </div>
          <div class="header-title">Fuel</div>
          <div class="header-right">
            <button class="btn btn-icon" id="btn-diet-goals" aria-label="Edit goals">${ICONS.target}</button>
          </div>
        </header>

        <div class="scroll">
          <p class="diet-date-line">${formatDateHeading(dateKey)}</p>

          <div class="diet-summary-card">
            ${macroBar('Calories', consumed.calories, goals.calories, pct.calories)}
            ${macroBar('Protein', consumed.proteinG, goals.proteinG, pct.proteinG)}
            ${macroBar('Carbs', consumed.carbsG, goals.carbsG, pct.carbsG)}
            ${macroBar('Fat', consumed.fatG, goals.fatG, pct.fatG)}
          </div>

          <div class="section-header" style="margin-top:8px">
            <span class="section-label">Today</span>
            <span class="section-count">${entries.length}</span>
          </div>

          <ul class="diet-entry-list">
            ${entries.length === 0
              ? `<li class="diet-empty">Nothing logged yet. Add food with text, a photo, or both.</li>`
              : entries.map(e => renderEntryRow(e, dateKey)).join('')}
          </ul>
        </div>

        <div class="diet-footer">
          <button class="btn btn-primary diet-log-btn" id="btn-open-log">Log food</button>
        </div>

        <div class="modal-backdrop hidden" id="diet-log-modal">
          <div class="modal diet-log-modal-inner">
            <div class="modal-handle"></div>
            <div class="modal-title">Log food</div>

            <div class="diet-mode-switch" role="tablist" aria-label="Log mode">
              <button type="button" class="diet-mode-btn diet-mode-active" data-mode="auto" role="tab">Auto</button>
              <button type="button" class="diet-mode-btn" data-mode="manual" role="tab">Manual</button>
            </div>

            <div id="diet-log-auto">
              <div id="diet-log-initial-inputs">
                <textarea class="input diet-log-textarea" id="diet-log-desc" rows="3" placeholder="e.g. Greek yogurt, berries, coffee with milk…"></textarea>
                <div class="diet-photo-row">
                  <input type="file" id="diet-log-photo" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" />
                  <button type="button" class="btn btn-secondary diet-photo-btn" id="btn-pick-photo">Use image</button>
                  <button type="button" class="btn btn-secondary diet-photo-btn" id="btn-use-favorite">Use saved</button>
                  <span class="diet-photo-name" id="diet-photo-label"></span>
                </div>
              </div>
              <div id="diet-preview-wrap" class="hidden"></div>
              <div id="diet-analysis-preview" class="diet-analysis-preview hidden"></div>
              <div id="diet-analysis-controls" class="diet-analysis-controls hidden">
                <div class="diet-analysis-title">Description</div>
                <p id="diet-analysis-description" class="diet-analysis-line"></p>
                <label class="diet-field" style="margin-top:8px">
                  <span>Corrections</span>
                  <textarea class="input diet-log-textarea" id="diet-analysis-corrections" rows="2" placeholder="e.g. this was half a portion, extra olive oil, no rice"></textarea>
                </label>
              </div>
            </div>

            <div id="diet-log-manual" class="hidden">
              <input class="input diet-manual-name" id="diet-manual-name" type="text" maxlength="120" placeholder="What did you eat? (optional)" />
              <div class="diet-manual-rows">
                ${manualMacroRow({ key: 'cal', label: 'Calories', unit: '', max: 2000, step: 5 })}
                ${manualMacroRow({ key: 'p',   label: 'Protein',  unit: 'g', max: 100,  step: 1 })}
                ${manualMacroRow({ key: 'c',   label: 'Carbs',    unit: 'g', max: 150,  step: 1 })}
                ${manualMacroRow({ key: 'f',   label: 'Fat',      unit: 'g', max: 100,  step: 1 })}
              </div>
            </div>

            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" id="diet-cancel">Cancel</button>
              <button type="button" class="btn btn-primary" id="diet-analyze">Analyze</button>
              <button type="button" class="btn btn-secondary hidden" id="diet-restart">Restart</button>
              <button type="button" class="btn btn-secondary hidden" id="diet-reanalyze">Reanalyze</button>
              <button type="button" class="btn btn-secondary hidden" id="diet-save-favorite">Save favorite</button>
              <button type="button" class="btn btn-primary hidden" id="diet-save-entry">Save</button>
              <button type="button" class="btn btn-primary hidden" id="diet-save-manual">Save</button>
            </div>
          </div>
        </div>
      </div>
    `

    bindMainEvents()
  }

  function renderEntryRow(entry, dk) {
    const safeAnalysis = entry?.analysis && typeof entry.analysis === 'object'
      ? entry.analysis
      : { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, summary: 'Logged meal' }
    const safeDescription = typeof entry?.description === 'string' ? entry.description : ''
    const thumb = entry.imageDataUrl
      ? `<div class="diet-entry-thumb"><img src="${entry.imageDataUrl}" alt="" /></div>`
      : `<div class="diet-entry-thumb diet-entry-thumb-placeholder">◇</div>`
    const trimmedDesc = safeDescription.trim()
    const desc = trimmedDesc
      ? escapeHtml(trimmedDesc.slice(0, 120)) + (trimmedDesc.length > 120 ? '…' : '')
      : '<span class="diet-entry-no-desc">Photo log</span>'
    return `
      <li class="diet-entry" data-id="${entry.id}">
        ${thumb}
        <div class="diet-entry-body">
          <div class="diet-entry-summary">${escapeHtml(safeAnalysis.summary || 'Logged meal')}</div>
          <div class="diet-entry-meta">${desc}</div>
          <div class="diet-entry-macros">
            ${Math.round(Number(safeAnalysis.calories) || 0)} kcal ·
            P ${fmtMacro(Number(safeAnalysis.proteinG) || 0)} ·
            C ${fmtMacro(Number(safeAnalysis.carbsG) || 0)} ·
            F ${fmtMacro(Number(safeAnalysis.fatG) || 0)}
          </div>
        </div>
        <button type="button" class="btn diet-entry-remove" data-remove="${entry.id}" aria-label="Remove">×</button>
      </li>
    `
  }

  function bindMainEvents() {
    container.querySelector('#btn-diet-back')?.addEventListener('click', () => navigate('home'))
    container.querySelector('#btn-diet-goals')?.addEventListener('click', () => navigate('diet-goals'))

    container.querySelector('#btn-open-log')?.addEventListener('click', () => {
      openLogModal()
    })

    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const id = btn.getAttribute('data-remove')
        if (id) removeEntry(todayKey(), id)
        render()
      })
    })
  }

  let pendingImage = /** @type {Awaited<ReturnType<typeof readImageFile>>} */ (null)
  let pendingAnalysis = /** @type {null | { calories: number, proteinG: number, carbsG: number, fatG: number, summary: string }} */ (null)
  let pendingDescription = ''
  /** @type {AbortController | null} */
  let logModalAbort = null

  function openLogModal() {
    logModalAbort?.abort()
    logModalAbort = new AbortController()
    const { signal } = logModalAbort

    pendingImage = null
    pendingAnalysis = null
    pendingDescription = ''
    const backdrop = container.querySelector('#diet-log-modal')
    const desc = container.querySelector('#diet-log-desc')
    const initialInputs = container.querySelector('#diet-log-initial-inputs')
    const photoInput = container.querySelector('#diet-log-photo')
    const label = container.querySelector('#diet-photo-label')
    const previewWrap = container.querySelector('#diet-preview-wrap')
    const analysisEl = container.querySelector('#diet-analysis-preview')
    const analysisControls = container.querySelector('#diet-analysis-controls')
    const analysisDescEl = container.querySelector('#diet-analysis-description')
    const correctionsEl = container.querySelector('#diet-analysis-corrections')
    const btnAnalyze = container.querySelector('#diet-analyze')
    const btnRestart = container.querySelector('#diet-restart')
    const btnReanalyze = container.querySelector('#diet-reanalyze')
    const btnSaveFavorite = container.querySelector('#diet-save-favorite')
    const btnSave = container.querySelector('#diet-save-entry')
    const btnSaveManual = container.querySelector('#diet-save-manual')
    const autoSection = container.querySelector('#diet-log-auto')
    const manualSection = container.querySelector('#diet-log-manual')
    const modeBtns = container.querySelectorAll('[data-mode]')
    const manualNameEl = container.querySelector('#diet-manual-name')
    const manualFields = [
      { key: 'cal', macroKey: 'calories' },
      { key: 'p',   macroKey: 'proteinG' },
      { key: 'c',   macroKey: 'carbsG' },
      { key: 'f',   macroKey: 'fatG' },
    ]
    let currentMode = 'auto'
    const currentTotals = dayTotals(todayKey(), load().goals).consumed

    backdrop?.classList.remove('hidden')
    if (desc) desc.value = ''
    if (photoInput) photoInput.value = ''
    if (label) label.textContent = ''
    if (previewWrap) {
      previewWrap.classList.add('hidden')
      previewWrap.innerHTML = ''
    }
    if (initialInputs) initialInputs.classList.remove('hidden')
    if (analysisEl) {
      analysisEl.classList.add('hidden')
      analysisEl.innerHTML = ''
    }
    if (analysisControls) analysisControls.classList.add('hidden')
    if (analysisDescEl) analysisDescEl.textContent = ''
    if (correctionsEl) correctionsEl.value = ''
    btnAnalyze?.classList.remove('hidden')
    btnRestart?.classList.add('hidden')
    btnReanalyze?.classList.add('hidden')
    btnSaveFavorite?.classList.add('hidden')
    btnSave?.classList.add('hidden')
    if (btnAnalyze) {
      btnAnalyze.textContent = 'Analyze'
      btnAnalyze.disabled = false
    }
    if (btnRestart) btnRestart.disabled = false
    if (btnReanalyze) {
      btnReanalyze.disabled = false
    }
    if (btnSave) btnSave.disabled = true
    btnSaveManual?.classList.add('hidden')
    if (manualNameEl) manualNameEl.value = ''
    manualFields.forEach(({ key }) => {
      const input = container.querySelector(`#diet-manual-${key}`)
      const slider = container.querySelector(`#diet-manual-${key}-slider`)
      if (input) input.value = '0'
      if (slider) slider.value = '0'
    })

    function setMode(nextMode) {
      currentMode = nextMode
      modeBtns.forEach(b => {
        b.classList.toggle('diet-mode-active', b.getAttribute('data-mode') === nextMode)
      })
      if (nextMode === 'auto') {
        autoSection?.classList.remove('hidden')
        manualSection?.classList.add('hidden')
        btnSaveManual?.classList.add('hidden')
        if (pendingAnalysis) {
          btnAnalyze?.classList.add('hidden')
          btnRestart?.classList.remove('hidden')
          btnReanalyze?.classList.remove('hidden')
          btnSaveFavorite?.classList.remove('hidden')
          btnSave?.classList.remove('hidden')
        } else {
          btnAnalyze?.classList.remove('hidden')
          btnRestart?.classList.add('hidden')
          btnReanalyze?.classList.add('hidden')
          btnSaveFavorite?.classList.add('hidden')
          btnSave?.classList.add('hidden')
        }
      } else {
        autoSection?.classList.add('hidden')
        manualSection?.classList.remove('hidden')
        btnAnalyze?.classList.add('hidden')
        btnRestart?.classList.add('hidden')
        btnReanalyze?.classList.add('hidden')
        btnSaveFavorite?.classList.add('hidden')
        btnSave?.classList.add('hidden')
        btnSaveManual?.classList.remove('hidden')
      }
    }
    modeBtns.forEach(b => {
      b.addEventListener('click', () => {
        const m = b.getAttribute('data-mode')
        if (m === 'auto' || m === 'manual') setMode(m)
      }, { signal })
    })

    manualFields.forEach(({ key }) => {
      const input = container.querySelector(`#diet-manual-${key}`)
      const slider = container.querySelector(`#diet-manual-${key}-slider`)
      if (!input || !slider) return
      const sync = (source) => {
        const raw = Number(source.value)
        const v = Number.isFinite(raw) ? Math.max(0, raw) : 0
        if (source === input) {
          const sliderMax = Number(slider.max) || 0
          if (v > sliderMax) slider.max = String(Math.ceil(v * 1.25))
          slider.value = String(v)
        } else {
          input.value = String(v)
        }
      }
      input.addEventListener('input', () => sync(input), { signal })
      slider.addEventListener('input', () => sync(slider), { signal })
    })

    setMode('auto')

    btnSaveManual?.addEventListener('click', () => {
      const get = (key) => {
        const v = Number(container.querySelector(`#diet-manual-${key}`)?.value)
        return Number.isFinite(v) && v >= 0 ? v : 0
      }
      const calories = Math.round(get('cal'))
      const proteinG = Number(get('p').toFixed(1))
      const carbsG = Number(get('c').toFixed(1))
      const fatG = Number(get('f').toFixed(1))
      if (calories === 0 && proteinG === 0 && carbsG === 0 && fatG === 0) {
        manualNameEl?.focus()
        return
      }
      const name = String(manualNameEl?.value || '').trim().slice(0, 120)
      const entry = {
        id: crypto.randomUUID(),
        loggedAt: new Date().toISOString(),
        description: name,
        analysis: {
          calories,
          proteinG,
          carbsG,
          fatG,
          summary: name || 'Manual entry',
        },
      }
      try {
        addEntry(todayKey(), entry)
        closeLogModal()
        render()
      } catch (err) {
        console.error(err)
      }
    }, { signal })

    function closeLogModal() {
      logModalAbort?.abort()
      logModalAbort = null
      container.querySelector('#diet-log-modal')?.classList.add('hidden')
    }

    container.querySelector('#diet-cancel')?.addEventListener('click', closeLogModal, { signal })

    container.querySelector('#btn-pick-photo')?.addEventListener('click', () => photoInput?.click(), { signal })
    container.querySelector('#btn-use-favorite')?.addEventListener('click', () => {
      openFavoritePicker({
        onPick: (fav) => {
          pendingAnalysis = fav.analysis
          pendingDescription = fav.description
          if (desc) desc.value = fav.description
          if (analysisDescEl) analysisDescEl.textContent = fav.description || 'Saved favorite'
          if (analysisEl) {
            const goals = load().goals
            analysisEl.innerHTML = `
              <div class="diet-analysis-title">Estimate</div>
              <p class="diet-analysis-line">${escapeHtml(fav.analysis.summary || fav.label)}</p>
              ${analysisComparisonBars(currentTotals, fav.analysis, goals)}
              <p class="diet-analysis-line">${escapeHtml(mealSuggestion(fav.analysis, currentTotals, goals))}</p>
            `
            analysisEl.classList.remove('hidden')
          }
          initialInputs?.classList.add('hidden')
          analysisControls?.classList.remove('hidden')
          btnAnalyze?.classList.add('hidden')
          btnRestart?.classList.remove('hidden')
          btnReanalyze?.classList.remove('hidden')
          btnSaveFavorite?.classList.remove('hidden')
          btnSave?.classList.remove('hidden')
          if (btnSave) btnSave.disabled = false
        },
      })
    }, { signal })

    photoInput?.addEventListener('change', async () => {
      const file = photoInput.files?.[0] || null
      if (!file) return
      if (label) label.textContent = file.name
      try {
        pendingImage = await readImageFile(file)
        if (pendingImage && previewWrap) {
          previewWrap.innerHTML = `<img class="diet-preview-img" src="${pendingImage.dataUrl}" alt="Preview" />`
          previewWrap.classList.remove('hidden')
        }
      } catch (err) {
        console.warn(err)
        pendingImage = null
      }
    }, { signal })

    async function runAnalysis({ fromReanalyze }) {
      const text = (desc?.value || '').trim()
      const corrections = (correctionsEl?.value || '').trim()
      if (!text && !pendingImage) {
        desc?.focus()
        return
      }
      if (!btnAnalyze || !analysisEl) return
      const triggerBtn = fromReanalyze ? btnReanalyze : btnAnalyze
      if (!triggerBtn) return
      triggerBtn.disabled = true
      triggerBtn.textContent = '…'
      try {
        const prompt = corrections
          ? `${text}\n\nCorrections from user: ${corrections}`
          : text
        const result = await analyzeMealReliable(prompt, pendingImage)
        pendingAnalysis = applyExplicitMacroOverrides(prompt, result)
        pendingDescription = text
        const goals = load().goals
        if (analysisDescEl) {
          analysisDescEl.textContent = text || 'Photo-only entry'
        }
        analysisEl.innerHTML = `
          <div class="diet-analysis-title">Estimate</div>
          <p class="diet-analysis-line">${escapeHtml(pendingAnalysis.summary)}</p>
          ${analysisComparisonBars(currentTotals, pendingAnalysis, goals)}
          <p class="diet-analysis-line">${escapeHtml(mealSuggestion(pendingAnalysis, currentTotals, goals))}</p>
        `
        analysisEl.classList.remove('hidden')
        initialInputs?.classList.add('hidden')
        analysisControls?.classList.remove('hidden')
        btnAnalyze.classList.add('hidden')
        btnRestart?.classList.remove('hidden')
        btnReanalyze?.classList.remove('hidden')
        btnSaveFavorite?.classList.remove('hidden')
        btnSave?.classList.remove('hidden')
        if (btnReanalyze) {
          btnReanalyze.textContent = 'Reanalyze'
          btnReanalyze.disabled = false
        }
        if (btnSave) btnSave.disabled = false
      } catch (err) {
        console.error(err)
        triggerBtn.textContent = fromReanalyze ? 'Reanalyze' : 'Retry'
        triggerBtn.disabled = false
        if (analysisEl) {
          analysisEl.innerHTML = `<p class="diet-analysis-err">Couldn’t analyze. Check your connection and try again.</p>`
          analysisEl.classList.remove('hidden')
        }
      }
    }

    btnAnalyze?.addEventListener('click', () => {
      runAnalysis({ fromReanalyze: false })
    }, { signal })

    function resetAnalysisState() {
      pendingAnalysis = null
      if (btnSave) btnSave.disabled = true
      btnRestart?.classList.add('hidden')
      btnReanalyze?.classList.add('hidden')
      btnSaveFavorite?.classList.add('hidden')
      btnSave?.classList.add('hidden')
      btnAnalyze?.classList.remove('hidden')
      if (btnAnalyze) {
        btnAnalyze.disabled = false
        btnAnalyze.textContent = 'Analyze'
      }
      analysisControls?.classList.add('hidden')
      analysisEl?.classList.add('hidden')
      if (analysisEl) analysisEl.innerHTML = ''
    }

    btnReanalyze?.addEventListener('click', () => {
      runAnalysis({ fromReanalyze: true })
    }, { signal })

    btnRestart?.addEventListener('click', () => {
      if (desc) desc.value = ''
      if (correctionsEl) correctionsEl.value = ''
      if (label) label.textContent = ''
      if (photoInput) photoInput.value = ''
      pendingImage = null
      if (previewWrap) {
        previewWrap.innerHTML = ''
        previewWrap.classList.add('hidden')
      }
      initialInputs?.classList.remove('hidden')
      resetAnalysisState()
      desc?.focus()
    }, { signal })

    btnSave?.addEventListener('click', () => {
      if (!pendingAnalysis || !btnSave) return
      btnSave.disabled = true
      const entry = {
        id: crypto.randomUUID(),
        loggedAt: new Date().toISOString(),
        description: pendingDescription,
        imageDataUrl: pendingImage?.dataUrl,
        analysis: {
          calories: pendingAnalysis.calories,
          proteinG: pendingAnalysis.proteinG,
          carbsG: pendingAnalysis.carbsG,
          fatG: pendingAnalysis.fatG,
          summary: pendingAnalysis.summary,
        },
      }
      try {
        addEntry(todayKey(), entry)
        closeLogModal()
        render()
      } catch (err) {
        console.error(err)
        // Fallback: save without photo if storage quota is hit by image payload.
        try {
          const fallbackEntry = { ...entry, imageDataUrl: undefined }
          addEntry(todayKey(), fallbackEntry)
          closeLogModal()
          render()
          return
        } catch (fallbackErr) {
          console.error(fallbackErr)
          btnSave.disabled = false
          if (analysisEl) {
            analysisEl.classList.remove('hidden')
            analysisEl.innerHTML += `<p class="diet-analysis-err">Couldn’t save this log. Try again, or restart without a photo.</p>`
          }
        }
      }
    }, { signal })

    btnSaveFavorite?.addEventListener('click', () => {
      if (!pendingAnalysis) return
      const baseLabel = pendingDescription.trim() || pendingAnalysis.summary || 'Saved favorite'
      const label = prompt('Favorite name', baseLabel.slice(0, 60))
      if (!label) return
      createFavorite({
        label: label.trim().slice(0, 60) || 'Saved favorite',
        description: pendingDescription,
        analysis: pendingAnalysis,
      })
    }, { signal })

    backdrop?.addEventListener('click', e => {
      if (e.target === backdrop) closeLogModal()
    }, { signal })
  }

  render()
}

function fmtMacro(n) {
  return n % 1 === 0 ? `${Math.round(n)}g` : `${n.toFixed(1)}g`
}

function signed(n) {
  return n >= 0 ? `+${n}` : String(n)
}

function signedFmt(n) {
  const out = n % 1 === 0 ? `${Math.round(n)}g` : `${n.toFixed(1)}g`
  return n >= 0 ? `+${out}` : out
}

function analysisComparisonBars(current, delta, goals) {
  const rows = [
    {
      label: 'Calories',
      current: current.calories,
      delta: delta.calories,
      goal: goals.calories,
      fmt: n => `${Math.round(n)}`,
    },
    {
      label: 'Protein',
      current: current.proteinG,
      delta: delta.proteinG,
      goal: goals.proteinG,
      fmt: n => fmtMacro(n),
    },
    {
      label: 'Carbs',
      current: current.carbsG,
      delta: delta.carbsG,
      goal: goals.carbsG,
      fmt: n => fmtMacro(n),
    },
    {
      label: 'Fat',
      current: current.fatG,
      delta: delta.fatG,
      goal: goals.fatG,
      fmt: n => fmtMacro(n),
    },
  ]
  return `
    <div class="diet-analysis-bars">
      ${rows.map(row => analysisComparisonRow(row)).join('')}
    </div>
  `
}

function analysisComparisonRow({ label, current, delta, goal, fmt }) {
  const currentPct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0
  const projected = current + delta
  const projectedPct = goal > 0 ? Math.min(100, (projected / goal) * 100) : 0
  const deltaPct = Math.max(0, projectedPct - currentPct)
  return `
    <div class="diet-analysis-bar-row">
      <div class="diet-analysis-bar-head">
        <span>${label}</span>
        <span>${fmt(projected)} (${signedFmt(delta)})</span>
      </div>
      <div class="diet-analysis-bar-stack">
        <div class="diet-bar-track">
          <div class="diet-bar-fill" style="width:${currentPct}%"></div>
          <div class="diet-bar-fill diet-bar-fill-delta" style="left:${currentPct}%;width:${deltaPct}%"></div>
        </div>
      </div>
    </div>
  `
}

function mealSuggestion(result, currentTotals, goals) {
  const projected = {
    calories: currentTotals.calories + result.calories,
    proteinG: currentTotals.proteinG + result.proteinG,
    carbsG: currentTotals.carbsG + result.carbsG,
    fatG: currentTotals.fatG + result.fatG,
  }
  const left = macroRemaining(projected, goals)
  if (left.fatG < -8 && left.proteinG > 15) {
    return 'Suggestion: next meal go low-fat high-protein, e.g. grilled chicken + rice + veg, or tuna + rice + fruit.'
  }
  if (left.fatG < -8) {
    return 'Suggestion: skip added fats next meal; choose lean options like turkey sandwich, sushi, or yogurt + fruit.'
  }
  if (left.proteinG > 20 && left.carbsG > 20) {
    return 'Suggestion: next meal could be a chicken rice bowl, turkey wrap + fruit, or tofu noodle stir-fry.'
  }
  if (left.proteinG > 20) {
    return 'Suggestion: add protein with greek yogurt + berries, protein shake + banana, or egg-white toast.'
  }
  if (left.carbsG > 25) {
    return 'Suggestion: add carbs with oatmeal + fruit, rice + lean protein, or toast + yogurt.'
  }
  if (left.fatG > 12) {
    return 'Suggestion: add healthy fats with salmon + rice, avocado toast, or yogurt + nuts.'
  }
  return 'Suggestion: you are close to target; keep the next meal light and balanced.'
}

/**
 * @param {{ onPick: (fav: import('./diet-storage.js').DietFavorite) => void }} options
 */
function openFavoritePicker(options) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = `
    <div class="modal-backdrop" id="diet-fav-modal">
      <div class="modal">
        <div class="modal-handle"></div>
        <div class="modal-title">Saved favorites</div>
        <div class="diet-fav-list">
          ${renderFavoriteList()}
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="diet-fav-close">Close</button>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(wrapper)
  const modal = wrapper.querySelector('#diet-fav-modal')

  const close = () => wrapper.remove()
  wrapper.querySelector('#diet-fav-close')?.addEventListener('click', close)
  modal?.addEventListener('click', e => {
    if (e.target === modal) close()
  })

  wrapper.querySelectorAll('[data-fav-use]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-fav-use')
      const fav = getFavorites().find(item => item.id === id)
      if (!fav) return
      close()
      options.onPick(fav)
    })
  })

  wrapper.querySelectorAll('[data-fav-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-fav-delete')
      if (!id) return
      if (!confirm('Delete this favorite?')) return
      deleteFavorite(id)
      close()
      openFavoritePicker(options)
    })
  })

  wrapper.querySelectorAll('[data-fav-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-fav-edit')
      const fav = getFavorites().find(item => item.id === id)
      if (!fav) return
      const label = prompt('Favorite name', fav.label)
      if (!label) return
      updateFavorite(id, { label: label.trim().slice(0, 60) || fav.label })
      close()
      openFavoritePicker(options)
    })
  })
}

function renderFavoriteList() {
  const favorites = getFavorites()
  if (!favorites.length) {
    return `<p class="diet-empty">No saved favorites yet. Analyze a meal, then tap "Save favorite".</p>`
  }
  return favorites.map(fav => `
    <div class="diet-fav-item">
      <div class="diet-fav-main">
        <div class="diet-fav-title">${escapeHtml(fav.label)}</div>
        <div class="diet-fav-meta">${Math.round(fav.analysis.calories)} kcal · P ${fmtMacro(fav.analysis.proteinG)} · C ${fmtMacro(fav.analysis.carbsG)} · F ${fmtMacro(fav.analysis.fatG)}</div>
      </div>
      <div class="diet-fav-actions">
        <button class="btn btn-secondary" type="button" data-fav-use="${fav.id}">Use</button>
        <button class="btn btn-secondary" type="button" data-fav-edit="${fav.id}">Edit</button>
        <button class="btn btn-secondary" type="button" data-fav-delete="${fav.id}">Delete</button>
      </div>
    </div>
  `).join('')
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDateHeading(key) {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const now = new Date()
  const isToday = dt.toDateString() === now.toDateString()
  const weekday = dt.toLocaleDateString(undefined, { weekday: 'long' })
  const md = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return isToday ? `Today · ${weekday}, ${md}` : `${weekday}, ${md}`
}

// ─── Goals view ───────────────────────────────────────────────────────────

export function renderDietGoals(container, { navigate }) {
  function render() {
    const g = load().goals
    container.innerHTML = `
      <div class="view" id="view-diet-goals">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-back" id="btn-goals-back">${ICONS.back} Fuel</button>
            <div class="header-title">Goals</div>
          </div>
        </header>
        <div class="scroll">
          <p class="diet-goals-intro">Daily targets reset at midnight (local time). Logs are grouped by calendar day.</p>
          <div class="diet-goals-form">
            <label class="diet-field">
              <span>Calories (kcal)</span>
              <input class="input" type="number" min="0" step="1" id="goal-cal" value="${g.calories}" />
            </label>
            <label class="diet-field">
              <span>Protein (g)</span>
              <input class="input" type="number" min="0" step="1" id="goal-p" value="${g.proteinG}" />
            </label>
            <label class="diet-field">
              <span>Carbs (g)</span>
              <input class="input" type="number" min="0" step="1" id="goal-c" value="${g.carbsG}" />
            </label>
            <label class="diet-field">
              <span>Fat (g)</span>
              <input class="input" type="number" min="0" step="1" id="goal-f" value="${g.fatG}" />
            </label>
            <button class="btn btn-primary" id="btn-save-goals" style="margin-top:12px">Save goals</button>
          </div>
        </div>
      </div>
    `

    container.querySelector('#btn-goals-back')?.addEventListener('click', () => navigate('diet'))
    container.querySelector('#btn-save-goals')?.addEventListener('click', () => {
      const cal = Number(container.querySelector('#goal-cal')?.value)
      const p = Number(container.querySelector('#goal-p')?.value)
      const c = Number(container.querySelector('#goal-c')?.value)
      const f = Number(container.querySelector('#goal-f')?.value)
      setGoals({
        calories: Number.isFinite(cal) ? cal : 2000,
        proteinG: Number.isFinite(p) ? p : 150,
        carbsG: Number.isFinite(c) ? c : 200,
        fatG: Number.isFinite(f) ? f : 65,
      })
      navigate('diet')
    })
  }

  render()
}
