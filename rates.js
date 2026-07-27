import { getCurrentTheme, toggleTheme } from './theme.js'
import { bottomChrome, gridMenuFab, textFab } from './chrome.js'

const KEY = 'ps_rates_v1'
const DAY_MS = 24 * 60 * 60 * 1000
/** Maintain always decays at exactly −1 token per day. */
const MAINTAIN_TOKENS_PER_DAY = 1

const DEFAULT_STATE = { trackers: [] }

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULT_STATE)
    const parsed = JSON.parse(raw)
    return {
      trackers: Array.isArray(parsed?.trackers)
        ? parsed.trackers.filter(t => t && t.id && t.name).map(normalizeTracker)
        : [],
    }
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

function normalizeMode(mode) {
  return mode === 'maintain' ? 'maintain' : 'refill'
}

function normalizeTracker(t) {
  const mode = normalizeMode(t.mode)
  const rateAmount = Math.max(0.01, Number(t.rateAmount) || 1)
  const rateDays = mode === 'maintain' ? 1 : Math.max(0.01, Number(t.rateDays) || 1)
  const cap = Math.max(1, Number(t.cap) || 1)
  const balance = Number(t.balance) || 0
  const lastTickAt = Number(t.lastTickAt) || Date.now()
  return {
    id: String(t.id),
    name: String(t.name || '').trim() || 'Untitled',
    mode,
    rateAmount,
    rateDays,
    cap,
    balance,
    lastTickAt,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || new Date().toISOString(),
    log: Array.isArray(t.log) ? t.log : [],
  }
}

/** Tokens added on each maintain log / top-up. */
function logAmount(t) {
  return Math.max(1, Math.round(Number(t.rateAmount) || 1))
}

function tokensPerMs(t) {
  if (t.mode === 'maintain') return MAINTAIN_TOKENS_PER_DAY / DAY_MS
  return Math.abs(t.rateAmount) / (t.rateDays * DAY_MS)
}

function currentBalance(t, now = Date.now()) {
  const rate = tokensPerMs(t)
  if (t.mode === 'maintain') {
    // Continuous −1/day decay; may go negative (maintenance debt).
    const lost = Math.max(0, now - t.lastTickAt) * rate
    return Math.min(t.cap, t.balance - lost)
  }
  if (t.balance >= t.cap) return t.cap
  const gained = Math.max(0, now - t.lastTickAt) * rate
  return Math.min(t.cap, t.balance + gained)
}

function settleTracker(t, now = Date.now()) {
  const balance = currentBalance(t, now)
  return { ...t, balance, lastTickAt: now, updatedAt: new Date(now).toISOString() }
}

function progressToNextToken(t, now = Date.now()) {
  const bal = currentBalance(t, now)
  if (bal >= t.cap) return { atCap: true, msUntilNext: null, nextLabel: 'At cap' }

  const nextWhole = Math.min(t.cap, Math.floor(bal) + 1)
  const need = Math.max(0, nextWhole - bal)
  const msUntilNext = need / tokensPerMs(t)
  return {
    atCap: false,
    msUntilNext,
    nextLabel: `in ${formatDuration(msUntilNext)}`,
    nextWhole,
  }
}

/** Time until the next whole token depletes (mirror of refill “in …”). */
function progressMaintain(t, now = Date.now()) {
  const bal = currentBalance(t, now)
  const target = Math.ceil(bal) - 1
  const need = Math.max(0, bal - target)
  const msUntilNext = need / tokensPerMs(t)
  return {
    msUntilNext,
    nextLabel: `in ${formatDuration(msUntilNext)}`,
    nextWhole: target,
  }
}

function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return 'now'
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 1) return '<1m'
  if (totalMin < 60) return `${totalMin}m`
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours < 48) {
    return mins ? `${hours}h ${mins}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remH = hours % 24
  return remH ? `${days}d ${remH}h` : `${days}d`
}

/** Display balance as a whole number, truncated toward zero (0.7→0, −2.5→−2). */
function formatBalance(bal) {
  if (!Number.isFinite(bal)) return '0'
  // Truncate toward zero while preserving sign for negative values
  if (bal < 0) {
    return String(Math.ceil(bal - 1e-9))
  }
  return String(Math.floor(bal + 1e-9))
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ratesStorage() {
  return {
    getAll() {
      return loadState().trackers.map(t => settleTracker(t))
    },

    get(id) {
      return this.getAll().find(t => t.id === id) || null
    },

    _write(trackers) {
      saveState({ trackers })
    },

    create({ name, mode, rateAmount, rateDays, cap, balance = 0 }) {
      const state = loadState()
      const now = Date.now()
      const capped = Math.floor(Math.max(1, Number(cap) || 1))
      const start = Math.min(capped, Number(balance) || 0)
      const tracker = normalizeTracker({
        id: crypto.randomUUID(),
        name,
        mode,
        rateAmount,
        rateDays: mode === 'maintain' ? 1 : rateDays,
        cap: capped,
        balance: start,
        lastTickAt: now,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        log: [],
      })
      state.trackers.unshift(tracker)
      this._write(state.trackers)
      return tracker
    },

    update(id, patch) {
      const state = loadState()
      const idx = state.trackers.findIndex(t => t.id === id)
      if (idx === -1) return null
      const settled = settleTracker(normalizeTracker(state.trackers[idx]))
      const next = normalizeTracker({
        ...settled,
        ...patch,
        id: settled.id,
        createdAt: settled.createdAt,
        log: settled.log,
        updatedAt: new Date().toISOString(),
        lastTickAt: Date.now(),
        balance: patch.balance != null ? Number(patch.balance) : settled.balance,
      })
      next.balance = Math.min(next.cap, next.balance)
      state.trackers[idx] = next
      this._write(state.trackers)
      return next
    },

    remove(id) {
      const state = loadState()
      state.trackers = state.trackers.filter(t => t.id !== id)
      this._write(state.trackers)
    },

    /** Spend one token. Balance can go negative. */
    consume(id) {
      const state = loadState()
      const idx = state.trackers.findIndex(t => t.id === id)
      if (idx === -1) return null
      const settled = settleTracker(normalizeTracker(state.trackers[idx]))
      const now = Date.now()
      const next = {
        ...settled,
        balance: settled.balance - 1,
        lastTickAt: now,
        updatedAt: new Date(now).toISOString(),
        log: [
          { id: crypto.randomUUID(), type: 'consume', amount: 1, at: new Date(now).toISOString() },
          ...(settled.log || []),
        ].slice(0, 50),
      }
      state.trackers[idx] = next
      this._write(state.trackers)
      return { tracker: next, ok: true }
    },

    /**
     * Add tokens. Refill: +1. Maintain: +logAmount (rateAmount), capped.
     */
    add(id) {
      const state = loadState()
      const idx = state.trackers.findIndex(t => t.id === id)
      if (idx === -1) return null
      const settled = settleTracker(normalizeTracker(state.trackers[idx]))
      const now = Date.now()
      const amount = settled.mode === 'maintain' ? logAmount(settled) : 1
      const next = {
        ...settled,
        balance: Math.min(settled.cap, settled.balance + amount),
        lastTickAt: now,
        updatedAt: new Date(now).toISOString(),
        log: [
          { id: crypto.randomUUID(), type: 'add', amount, at: new Date(now).toISOString() },
          ...(settled.log || []),
        ].slice(0, 50),
      }
      state.trackers[idx] = next
      this._write(state.trackers)
      return { tracker: next, ok: true, amount }
    },
  }
}

const storage = ratesStorage()

function renderTokenBadge(bal) {
  const text = formatBalance(bal)
  const negative = bal < -1e-9
  return `<span class="rates-token${negative ? ' is-negative' : ''}" aria-label="${escapeHtml(text)} tokens">${escapeHtml(text)}</span>`
}

export function renderRates(container, { navigate }) {
  let editingId = null
  let modalMode = null // 'add' | 'edit'
  let toast = ''

  function showToast(msg) {
    toast = msg
    rerender()
    setTimeout(() => {
      if (toast === msg) {
        toast = ''
        rerender()
      }
    }, 1800)
  }

  function openAdd() {
    editingId = null
    modalMode = 'add'
    rerender()
  }

  function openEdit(id) {
    editingId = id
    modalMode = 'edit'
    rerender()
  }

  function closeModal() {
    editingId = null
    modalMode = null
    rerender()
  }

  function selectedMode(root) {
    return normalizeMode(root.querySelector('.rates-mode-btn.is-active')?.dataset.mode)
  }

  function parseForm(root) {
    const name = String(root.querySelector('#rates-name')?.value || '').trim()
    const mode = selectedMode(root)
    const rateAmount = Number(root.querySelector('#rates-amount')?.value)
    const rateDays = mode === 'maintain' ? 1 : Number(root.querySelector('#rates-days')?.value)
    const cap = Number(root.querySelector('#rates-cap')?.value)
    const balance = Number(root.querySelector('#rates-start')?.value)
    if (!name) return { error: 'Give it a name.' }
    if (!Number.isFinite(rateAmount) || rateAmount <= 0) {
      return { error: mode === 'maintain' ? 'Tokens per log must be greater than 0.' : 'Rate amount must be greater than 0.' }
    }
    if (mode !== 'maintain' && (!Number.isFinite(rateDays) || rateDays <= 0)) {
      return { error: 'Period must be greater than 0 days.' }
    }
    if (!Number.isFinite(cap) || cap < 1) return { error: 'Cap must be at least 1.' }
    if (!Number.isFinite(balance)) return { error: 'Starting tokens must be a number.' }
    const capInt = Math.floor(cap)
    if (balance > capInt) return { error: 'Starting tokens can’t exceed the cap.' }
    return {
      name,
      mode,
      rateAmount: mode === 'maintain' ? Math.max(1, Math.round(rateAmount)) : rateAmount,
      rateDays,
      cap: capInt,
      balance,
    }
  }

  function saveModal() {
    const parsed = parseForm(container)
    if (parsed.error) {
      showToast(parsed.error)
      return
    }
    if (modalMode === 'edit' && editingId) {
      storage.update(editingId, parsed)
    } else {
      storage.create(parsed)
    }
    closeModal()
  }

  function maintainHint(amount) {
    return `Decays −1 per day. Tap +${amount} to log a top-up; long-press to spend 1.`
  }

  function spendHint() {
    return 'Tokens refill over time up to the cap. Tap −1 to spend; long-press to add +1.'
  }

  function renderCard(t) {
    const bal = currentBalance(t)
    const isMaintain = t.mode === 'maintain'
    const prog = isMaintain ? progressMaintain(t) : progressToNextToken(t)
    const amount = logAmount(t)
    const actionLabel = isMaintain ? `+${amount}` : '−1'
    const actionAria = isMaintain
      ? `Top up ${amount} tokens. Long press to spend 1.`
      : 'Use 1 token. Long press to add 1.'

    return `
      <li class="item rates-item" data-tracker-id="${t.id}" data-mode="${t.mode}">
        <button type="button" class="rates-item-main" data-edit-tracker="${t.id}">
          <span class="rates-item-name item-title">${escapeHtml(t.name)}</span>
          <div class="rates-item-stats">
            ${renderTokenBadge(bal)}
            <span class="rates-next text-body-sm">${escapeHtml(prog.nextLabel)}</span>
          </div>
        </button>
        <button
          type="button"
          class="rates-use-btn"
          data-rate-action="${t.id}"
          data-mode="${t.mode}"
          aria-label="${actionAria}"
        >${actionLabel}</button>
      </li>
    `
  }

  function renderSection(label, items, { spaced } = {}) {
    if (!items.length) return ''
    return `
      <div class="section-header"${spaced ? ' style="margin-top:12px"' : ''}>
        <span class="section-label">${escapeHtml(label)}</span>
        <span class="section-count">${items.length}</span>
      </div>
      <ul class="item-list rates-list">
        ${items.map(renderCard).join('')}
      </ul>
    `
  }

  function renderModeFields(mode, { rateAmount, rateDays, cap, startBal, startLabel }) {
    if (mode === 'maintain') {
      return `
        <label class="rates-field">
          <span class="rates-field-label">Tokens per log</span>
          <input class="input" id="rates-amount" type="number" min="1" step="1" inputmode="numeric" value="${rateAmount}" />
        </label>
        <p class="diet-modal-hint rates-fixed-rate">Depletes at −1 token per day.</p>
        <div class="rates-field-row">
          <label class="rates-field">
            <span class="rates-field-label">${startLabel}</span>
            <input class="input" id="rates-start" type="number" step="any" inputmode="decimal" value="${startBal}" />
          </label>
          <label class="rates-field">
            <span class="rates-field-label">Max tokens (cap)</span>
            <input class="input" id="rates-cap" type="number" min="1" step="1" inputmode="numeric" value="${cap}" />
          </label>
        </div>
      `
    }
    return `
      <div class="rates-field-row">
        <label class="rates-field">
          <span class="rates-field-label">Tokens</span>
          <input class="input" id="rates-amount" type="number" step="any" inputmode="decimal" value="${rateAmount}" />
        </label>
        <span class="rates-field-join">per</span>
        <label class="rates-field">
          <span class="rates-field-label">Days</span>
          <input class="input" id="rates-days" type="number" min="0.01" step="any" inputmode="decimal" value="${rateDays}" />
        </label>
      </div>
      <div class="rates-field-row">
        <label class="rates-field">
          <span class="rates-field-label">${startLabel}</span>
          <input class="input" id="rates-start" type="number" step="any" inputmode="decimal" value="${startBal}" />
        </label>
        <label class="rates-field">
          <span class="rates-field-label">Max tokens (cap)</span>
          <input class="input" id="rates-cap" type="number" min="1" step="1" inputmode="numeric" value="${cap}" />
        </label>
      </div>
    `
  }

  function renderModal() {
    if (!modalMode) return ''
    const existing = editingId ? storage.get(editingId) : null
    const isEdit = modalMode === 'edit' && existing
    const title = isEdit ? 'Edit rate' : 'New rate'
    const name = isEdit ? existing.name : ''
    const mode = isEdit ? existing.mode : 'refill'
    const rateAmount = isEdit
      ? (mode === 'maintain' ? logAmount(existing) : existing.rateAmount)
      : 1
    const rateDays = isEdit ? existing.rateDays : 3
    const cap = isEdit ? existing.cap : 5
    const startBal = isEdit ? formatBalance(currentBalance(existing)) : (mode === 'maintain' ? 5 : 0)
    const startLabel = isEdit ? 'Current tokens' : 'Starting tokens'
    const hint = mode === 'maintain' ? maintainHint(rateAmount) : spendHint()

    return `
      <div class="modal-backdrop" id="rates-modal">
        <div class="modal rates-modal">
          <div class="modal-handle"></div>
          <div class="modal-title">${title}</div>
          <div class="rates-mode-switch" role="group" aria-label="Rate type">
            <button type="button" class="rates-mode-btn${mode === 'refill' ? ' is-active' : ''}" data-mode="refill">Spend</button>
            <button type="button" class="rates-mode-btn${mode === 'maintain' ? ' is-active' : ''}" data-mode="maintain">Maintain</button>
          </div>
          <label class="rates-field">
            <span class="rates-field-label">Name</span>
            <input class="input" id="rates-name" type="text" maxlength="80" placeholder="e.g. Drinks" value="${escapeHtml(name)}" autocomplete="off" />
          </label>
          <div id="rates-mode-fields">
            ${renderModeFields(mode, { rateAmount, rateDays, cap, startBal, startLabel })}
          </div>
          <p class="diet-modal-hint" id="rates-modal-hint">${hint}</p>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="rates-modal-cancel" type="button">Cancel</button>
            <button class="btn btn-cta" id="rates-modal-save" type="button">${isEdit ? 'Save' : 'Add'}</button>
          </div>
          ${isEdit ? `<button class="btn btn-danger rates-delete-btn" id="rates-modal-delete" type="button">Delete</button>` : ''}
        </div>
      </div>
    `
  }

  function rerender() {
    const trackers = storage.getAll()
    storage._write(trackers.map(t => ({ ...t })))

    const spends = trackers.filter(t => t.mode !== 'maintain')
    const maintains = trackers.filter(t => t.mode === 'maintain')

    container.innerHTML = `
      <div class="view" id="view-rates">
        <header class="header">
          <div class="header-left"></div>
          <div class="header-title">Rates</div>
          <div class="header-right">
            <button class="btn-icon theme-toggle" id="btn-theme-toggle" aria-label="Toggle theme"></button>
          </div>
        </header>

        <div class="scroll">
          ${trackers.length === 0 ? `
            <div class="empty-state rates-empty">
              <p>Track spend budgets or levels you need to maintain.</p>
              <p class="text-body-sm" style="color:var(--text-secondary);margin-top:8px">Spend earns tokens over time. Maintain decays −1/day — log top-ups to keep the level.</p>
            </div>
          ` : `
            ${renderSection('Spend', spends)}
            ${renderSection('Maintains', maintains, { spaced: spends.length > 0 })}
          `}
        </div>

        ${bottomChrome({
          left: gridMenuFab('btn-rates-home'),
          right: textFab({ id: 'btn-rates-add', label: 'Add' }),
        })}
        ${toast ? `<div class="rates-toast" role="status">${escapeHtml(toast)}</div>` : ''}
        ${renderModal()}
      </div>
    `

    bind()
  }

  function bind() {
    container.querySelector('#btn-rates-home')?.addEventListener('click', () => navigate('home'))
    container.querySelector('#btn-rates-add')?.addEventListener('click', openAdd)

    const themeBtn = container.querySelector('#btn-theme-toggle')
    if (themeBtn) {
      function updateIcon() {
        themeBtn.textContent = getCurrentTheme() === 'dark' ? '☀' : '☾'
      }
      updateIcon()
      themeBtn.addEventListener('click', () => {
        toggleTheme()
        updateIcon()
      })
    }

    container.querySelectorAll('[data-edit-tracker]').forEach(btn => {
      btn.addEventListener('click', () => openEdit(btn.dataset.editTracker))
    })

    container.querySelectorAll('[data-rate-action]').forEach(btn => {
      let pressTimer = null
      let isLongPress = false
      let startX = 0
      let startY = 0
      let hasMoved = false
      const mode = btn.dataset.mode
      const MOVE_THRESHOLD = 10 // pixels

      const startPress = (e) => {
        e.stopPropagation()
        e.preventDefault()
        isLongPress = false
        hasMoved = false
        
        // Record starting position
        const touch = e.touches?.[0] || e
        startX = touch.clientX || 0
        startY = touch.clientY || 0
        
        pressTimer = setTimeout(() => {
          if (hasMoved) return // Don't trigger long press if dragging
          isLongPress = true
          const id = btn.dataset.rateAction
          if (mode === 'maintain') {
            const result = storage.consume(id)
            if (!result) return
            showToast('Used −1')
          } else {
            const result = storage.add(id)
            if (!result) return
            showToast('Added +1')
          }
        }, 1000)
      }

      const movePress = (e) => {
        if (!pressTimer && !isLongPress) return
        const touch = e.touches?.[0] || e
        const currentX = touch.clientX || 0
        const currentY = touch.clientY || 0
        const deltaX = Math.abs(currentX - startX)
        const deltaY = Math.abs(currentY - startY)
        
        // If moved more than threshold, cancel the press
        if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
          hasMoved = true
          cancelPress()
        }
      }

      const endPress = (e) => {
        e.stopPropagation()
        if (pressTimer) {
          clearTimeout(pressTimer)
          pressTimer = null
        }
        
        // Don't trigger if we detected movement (drag)
        if (!isLongPress && !hasMoved) {
          const id = btn.dataset.rateAction
          if (mode === 'maintain') {
            const result = storage.add(id)
            if (!result) return
            showToast(`Topped up +${result.amount}`)
          } else {
            const result = storage.consume(id)
            if (!result) return
            showToast('Used −1')
          }
        }
        isLongPress = false
        hasMoved = false
      }

      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer)
          pressTimer = null
        }
        isLongPress = false
      }

      btn.addEventListener('mousedown', startPress)
      btn.addEventListener('touchstart', startPress, { passive: false })
      btn.addEventListener('mousemove', movePress)
      btn.addEventListener('touchmove', movePress, { passive: false })
      btn.addEventListener('mouseup', endPress)
      btn.addEventListener('touchend', endPress)
      btn.addEventListener('mouseleave', cancelPress)
      btn.addEventListener('touchcancel', cancelPress)
      btn.addEventListener('click', e => e.preventDefault())
    })

    const backdrop = container.querySelector('#rates-modal')
    backdrop?.addEventListener('click', e => {
      if (e.target === backdrop) closeModal()
    })
    container.querySelector('#rates-modal-cancel')?.addEventListener('click', closeModal)
    container.querySelector('#rates-modal-save')?.addEventListener('click', saveModal)
    container.querySelector('#rates-modal-delete')?.addEventListener('click', () => {
      if (!editingId) return
      if (!confirm('Delete this rate?')) return
      storage.remove(editingId)
      closeModal()
    })

    const hint = container.querySelector('#rates-modal-hint')
    const fields = container.querySelector('#rates-mode-fields')
    const modal = container.querySelector('.rates-modal')

    function syncMaintainHint() {
      if (!hint || selectedMode(container) !== 'maintain') return
      const n = Math.max(1, Math.round(Number(container.querySelector('#rates-amount')?.value) || 1))
      hint.textContent = maintainHint(n)
    }

    container.querySelectorAll('.rates-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.rates-mode-btn').forEach(b => b.classList.toggle('is-active', b === btn))
        const mode = btn.dataset.mode
        const name = container.querySelector('#rates-name')?.value || ''
        const existing = editingId ? storage.get(editingId) : null
        const isEdit = modalMode === 'edit' && existing
        const rateAmount = Number(container.querySelector('#rates-amount')?.value) || 1
        const rateDays = Number(container.querySelector('#rates-days')?.value) || 3
        const cap = Number(container.querySelector('#rates-cap')?.value) || 5
        const startBal = container.querySelector('#rates-start')?.value ?? (mode === 'maintain' ? 5 : 0)
        const startLabel = isEdit ? 'Current tokens' : 'Starting tokens'
        if (fields) {
          fields.innerHTML = renderModeFields(mode, {
            rateAmount: mode === 'maintain' ? Math.max(1, Math.round(rateAmount) || 1) : rateAmount,
            rateDays,
            cap,
            startBal,
            startLabel,
          })
        }
        if (hint) {
          hint.textContent = mode === 'maintain'
            ? maintainHint(Math.max(1, Math.round(rateAmount) || 1))
            : spendHint()
        }
        const nameInput = container.querySelector('#rates-name')
        if (nameInput) nameInput.value = name
      })
    })

    modal?.addEventListener('input', e => {
      if (e.target?.id === 'rates-amount') syncMaintainHint()
    })

    const nameInput = container.querySelector('#rates-name')
    if (nameInput && modalMode) {
      setTimeout(() => nameInput.focus(), 50)
      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') saveModal()
        if (e.key === 'Escape') closeModal()
      })
    }
  }

  rerender()
}
