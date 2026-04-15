/**
 * Diet tracker — goals, daily log, AI estimates from text and/or photos.
 * Uses the same Cloudflare worker as Coach (Anthropic Messages API).
 */

import {
  load,
  save,
  todayKey,
  getDay,
  addEntry,
  removeEntry,
  setGoals,
  dayTotals,
} from './diet-storage.js'

// ─── Config (match coach.js worker) ───────────────────────────────────────

const WORKER_URL = 'https://jos.jerry-si-chang.workers.dev'
const DIET_MODEL = 'claude-sonnet-4-20250514'

const ANALYSIS_SYSTEM = `You estimate calories and macronutrients for a single eating occasion.

The user may describe food in text, attach a photo of a meal, or both. Use every clue you have. If portions are unclear, make your best reasonable guess and say so briefly in the summary.

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
            <button class="btn btn-icon menu-grid-btn" id="btn-diet-back" aria-label="Menu"><span class="menu-grid-icon" aria-hidden="true"></span></button>
            <div class="header-title">Fuel</div>
          </div>
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
          <div class="diet-reco-card">
            <div class="diet-analysis-title">Recommendation</div>
            <p class="diet-analysis-line">${escapeHtml(dayRecommendation(consumed, goals))}</p>
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
            <p class="diet-modal-hint">Describe what you ate and/or add a photo. We’ll estimate calories and macros.</p>
            <div id="diet-log-initial-inputs">
              <textarea class="input diet-log-textarea" id="diet-log-desc" rows="3" placeholder="e.g. Greek yogurt, berries, coffee with milk…"></textarea>
              <div class="diet-photo-row">
                <input type="file" id="diet-log-photo" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" />
                <button type="button" class="btn btn-secondary diet-photo-btn" id="btn-pick-photo">Photo</button>
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
            <div class="modal-actions">
              <button type="button" class="btn" id="diet-cancel">Cancel</button>
              <button type="button" class="btn btn-primary" id="diet-analyze">Analyze</button>
              <button type="button" class="btn btn-secondary hidden" id="diet-restart">Restart</button>
              <button type="button" class="btn btn-secondary hidden" id="diet-reanalyze">Reanalyze</button>
              <button type="button" class="btn btn-primary hidden" id="diet-save-entry">Save</button>
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
    const btnSave = container.querySelector('#diet-save-entry')
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

    function closeLogModal() {
      logModalAbort?.abort()
      logModalAbort = null
      container.querySelector('#diet-log-modal')?.classList.add('hidden')
    }

    container.querySelector('#diet-cancel')?.addEventListener('click', closeLogModal, { signal })

    container.querySelector('#btn-pick-photo')?.addEventListener('click', () => photoInput?.click(), { signal })

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
        const result = await analyzeMeal(prompt, pendingImage)
        pendingAnalysis = result
        pendingDescription = text
        const goals = load().goals
        if (analysisDescEl) {
          analysisDescEl.textContent = text || 'Photo-only entry'
        }
        analysisEl.innerHTML = `
          <div class="diet-analysis-title">Estimate</div>
          <p class="diet-analysis-line">${escapeHtml(result.summary)}</p>
          ${analysisComparisonBars(currentTotals, result, goals)}
          <p class="diet-analysis-line">${escapeHtml(mealSuggestion(result, currentTotals, goals))}</p>
        `
        analysisEl.classList.remove('hidden')
        initialInputs?.classList.add('hidden')
        analysisControls?.classList.remove('hidden')
        btnAnalyze.classList.add('hidden')
        btnRestart?.classList.remove('hidden')
        btnReanalyze?.classList.remove('hidden')
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

function dayRecommendation(consumed, goals) {
  const left = macroRemaining(consumed, goals)
  const nowHour = new Date().getHours()
  const overFat = left.fatG < -8
  const overCarbs = left.carbsG < -20
  const lowProtein = left.proteinG > 18

  if (overFat && lowProtein) {
    return nowHour < 17
      ? 'Try a low-fat, high-protein meal: grilled chicken rice bowl (minimal oil) or tuna + rice + fruit.'
      : 'Try a low-fat evening option: egg-white scramble with toast, or 0% greek yogurt with berries and cereal.'
  }
  if (overFat) {
    return 'You are already high on fat today: choose lean options next (turkey sandwich, chicken wrap, sushi, fruit + yogurt).'
  }
  if (overCarbs && lowProtein) {
    return 'Carbs are already high: pick a protein-forward snack like greek yogurt, protein shake + banana, or cottage cheese + fruit.'
  }
  if (left.proteinG > 20 && left.carbsG > 20) {
    return 'Balanced top-up idea: chicken rice bowl, turkey sandwich + fruit, or tofu stir-fry with rice.'
  }
  if (left.proteinG > 20) {
    return 'Protein-focused idea: tuna wrap, greek yogurt + whey, or egg-white omelet with toast.'
  }
  if (left.carbsG > 25) {
    return 'Carb-focused idea: oatmeal + banana, rice + lean protein, or toast with jam + yogurt.'
  }
  if (left.fatG > 12) {
    return 'Healthy-fat add-on: avocado toast with eggs, salmon with rice, or yogurt + nuts.'
  }
  return 'You are close to target: keep the next meal light and balanced (lean protein + veggie + modest carb).'
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
