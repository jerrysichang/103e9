import { getCurrentTheme, toggleTheme } from './theme.js'

const KEY = 'ps_rates_v1'
const DAY_MS = 24 * 60 * 60 * 1000
const TOKEN_STACK_MAX = 10

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
  const rateAmount = Number(t.rateAmount) || 1
  const rateDays = Math.max(0.01, Number(t.rateDays) || 1)
  const cap = Math.max(1, Number(t.cap) || 1)
  const balance = Number(t.balance) || 0
  const lastTickAt = Number(t.lastTickAt) || Date.now()
  return {
    id: String(t.id),
    name: String(t.name || '').trim() || 'Untitled',
    mode: normalizeMode(t.mode),
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

function tokensPerMs(t) {
  return Math.abs(t.rateAmount) / (t.rateDays * DAY_MS)
}

function currentBalance(t, now = Date.now()) {
  const rate = tokensPerMs(t)
  if (t.mode === 'maintain') {
    if (t.balance <= 0) return t.balance
    const lost = Math.max(0, now - t.lastTickAt) * rate
    return Math.max(0, Math.min(t.cap, t.balance - lost))
  }
  if (t.balance >= t.cap) return t.cap
  const gained = Math.max(0, now - t.lastTickAt) * rate
  return Math.min(t.cap, t.balance + gained)
}

function settleTracker(t, now = Date.now()) {
  const balance = currentBalance(t, now)
  return { ...t, balance, lastTickAt: now, updatedAt: new Date(now).toISOString() }
}

/** Whole tokens the user can spend right now (fractional progress does not count). */
function usableTokens(bal) {
  return Math.max(0, Math.floor(bal + 1e-9))
}

function progressToNextToken(t, now = Date.now()) {
  const bal = currentBalance(t, now)
  if (bal >= t.cap) return { atCap: true, progress: 1, msUntilNext: null, nextLabel: 'At cap' }

  const nextWhole = Math.min(t.cap, Math.floor(bal) + 1)
  const need = Math.max(0, nextWhole - bal)
  const msUntilNext = need / tokensPerMs(t)
  const progress = bal - Math.floor(bal)
  return {
    atCap: false,
    progress,
    msUntilNext,
    nextLabel: `in ${formatDuration(msUntilNext)}`,
    nextWhole,
  }
}

function progressMaintain(t, now = Date.now()) {
  const bal = currentBalance(t, now)
  if (bal <= 0) {
    return { empty: true, progress: 0, msUntilEmpty: null, nextLabel: 'Empty' }
  }
  const msUntilEmpty = bal / tokensPerMs(t)
  return {
    empty: false,
    progress: Math.min(1, bal / t.cap),
    msUntilEmpty,
    nextLabel: `empty in ${formatDuration(msUntilEmpty)}`,
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

function formatBalance(bal) {
  const whole = Math.floor(bal + 1e-9)
  const frac = bal - whole
  if (frac < 0.05) return String(whole)
  return bal.toFixed(1).replace(/\.0$/, '')
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
      const start = Math.min(capped, Math.max(0, Number(balance) || 0))
      const tracker = normalizeTracker({
        id: crypto.randomUUID(),
        name,
        mode,
        rateAmount,
        rateDays,
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
      // Clamp to cap if above, but allow negative values
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

    /** Add one token. Capped at max. */
    add(id) {
      const state = loadState()
      const idx = state.trackers.findIndex(t => t.id === id)
      if (idx === -1) return null
      const settled = settleTracker(normalizeTracker(state.trackers[idx]))
      const now = Date.now()
      const next = {
        ...settled,
        balance: Math.min(settled.cap, settled.balance + 1),
        lastTickAt: now,
        updatedAt: new Date(now).toISOString(),
        log: [
          { id: crypto.randomUUID(), type: 'add', amount: 1, at: new Date(now).toISOString() },
          ...(settled.log || []),
        ].slice(0, 50),
      }
      state.trackers[idx] = next
      this._write(state.trackers)
      return { tracker: next, ok: true }
    },
  }
}

const storage = ratesStorage()

function renderTokenStack(whole) {
  const usable = Math.max(0, whole)
  const shown = Math.min(usable, TOKEN_STACK_MAX)
  if (usable === 0) {
    return `<span class="rates-token-stack rates-token-stack-empty" aria-label="0 tokens"><span class="rates-token-disc is-empty">0</span></span>`
  }
  const discs = Array.from({ length: shown }, (_, i) => {
    const isFront = i === 0
    const label = isFront ? String(usable) : ''
    return `<span class="rates-token-disc${isFront ? ' is-front' : ''}" ${isFront ? '' : 'aria-hidden="true"'}>${label}</span>`
  }).join('')
  return `<span class="rates-token-stack" aria-label="${usable} ${usable === 1 ? 'token' : 'tokens'}">${discs}</span>`
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

  function parseForm(root) {
    const name = String(root.querySelector('#rates-name')?.value || '').trim()
    const mode = normalizeMode(root.querySelector('.rates-mode-btn.is-active')?.dataset.mode)
    const rateAmount = Number(root.querySelector('#rates-amount')?.value)
    const rateDays = Number(root.querySelector('#rates-days')?.value)
    const cap = Number(root.querySelector('#rates-cap')?.value)
    const balance = Number(root.querySelector('#rates-start')?.value)
    if (!name) return { error: 'Give it a name.' }
    if (!Number.isFinite(rateAmount)) return { error: 'Rate amount must be a valid number.' }
    if (!Number.isFinite(rateDays) || rateDays <= 0) return { error: 'Period must be greater than 0 days.' }
    if (!Number.isFinite(cap) || cap < 1) return { error: 'Cap must be at least 1.' }
    if (!Number.isFinite(balance) || balance < 0) return { error: 'Starting tokens can’t be negative.' }
    const capInt = Math.floor(cap)
    if (balance > capInt) return { error: 'Starting tokens can’t exceed the cap.' }
    return { name, mode, rateAmount, rateDays, cap: capInt, balance }
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

  function renderCard(t) {
    const bal = currentBalance(t)
    const whole = usableTokens(bal)
    const isMaintain = t.mode === 'maintain'
    const prog = isMaintain ? progressMaintain(t) : progressToNextToken(t)
    const actionLabel = isMaintain ? '+1' : '−1'
    const actionAria = isMaintain
      ? 'Top up 1 token. Long press to spend 1.'
      : 'Use 1 token. Long press to add 1.'

    return `
      <li class="item rates-item" data-tracker-id="${t.id}" data-mode="${t.mode}">
        <button type="button" class="rates-item-main" data-edit-tracker="${t.id}">
          <span class="rates-item-name item-title">${escapeHtml(t.name)}</span>
          <div class="rates-item-stats">
            ${renderTokenStack(whole)}
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

  function renderModal() {
    if (!modalMode) return ''
    const existing = editingId ? storage.get(editingId) : null
    const isEdit = modalMode === 'edit' && existing
    const title = isEdit ? 'Edit rate' : 'New rate'
    const name = isEdit ? existing.name : ''
    const mode = isEdit ? existing.mode : 'refill'
    const rateAmount = isEdit ? existing.rateAmount : 1
    const rateDays = isEdit ? existing.rateDays : 3
    const cap = isEdit ? existing.cap : 5
    const startBal = isEdit ? formatBalance(currentBalance(existing)) : (mode === 'maintain' ? 5 : 0)
    const startLabel = isEdit ? 'Current tokens' : 'Starting tokens'
    const hint = mode === 'maintain'
      ? 'Tokens decay over time. Tap +1 to top up; long-press to spend 1.'
      : 'Tokens refill over time up to the cap. Tap −1 to spend; long-press to add +1.'

    return `
      <div class="modal-backdrop" id="rates-modal">
        <div class="modal rates-modal">
          <div class="modal-handle"></div>
          <div class="modal-title">${title}</div>
          <div class="rates-mode-switch" role="group" aria-label="Rate type">
            <button type="button" class="rates-mode-btn${mode === 'refill' ? ' is-active' : ''}" data-mode="refill">Refill</button>
            <button type="button" class="rates-mode-btn${mode === 'maintain' ? ' is-active' : ''}" data-mode="maintain">Maintain</button>
          </div>
          <label class="rates-field">
            <span class="rates-field-label">Name</span>
            <input class="input" id="rates-name" type="text" maxlength="80" placeholder="e.g. Drinks" value="${escapeHtml(name)}" autocomplete="off" />
          </label>
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
              <input class="input" id="rates-start" type="number" min="0" step="any" inputmode="decimal" value="${startBal}" />
            </label>
            <label class="rates-field">
              <span class="rates-field-label">Max tokens (cap)</span>
              <input class="input" id="rates-cap" type="number" min="1" step="1" inputmode="numeric" value="${cap}" />
            </label>
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
    // Persist settled balances so reopen stays accurate
    const trackers = storage.getAll()
    storage._write(trackers.map(t => ({ ...t })))

    const refills = trackers.filter(t => t.mode !== 'maintain')
    const maintains = trackers.filter(t => t.mode === 'maintain')

    container.innerHTML = `
      <div class="view" id="view-rates">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-icon menu-grid-btn header-menu-btn" id="btn-rates-home" aria-label="Menu">
              <span class="menu-grid-icon" aria-hidden="true"></span>
            </button>
          </div>
          <div class="header-title">Rates</div>
          <div class="header-right">
            <button class="btn-icon theme-toggle" id="btn-theme-toggle" aria-label="Toggle theme"></button>
          </div>
        </header>

        <div class="scroll">
          ${trackers.length === 0 ? `
            <div class="empty-state rates-empty">
              <p>Track refill budgets or levels you need to maintain.</p>
              <p class="text-body-sm" style="color:var(--text-secondary);margin-top:8px">Refill earns tokens over time. Maintain decays — top up to keep the level.</p>
            </div>
          ` : `
            ${renderSection('Refills', refills)}
            ${renderSection('Maintains', maintains, { spaced: refills.length > 0 })}
          `}
        </div>

        <button class="btn btn-primary fab-btn" id="btn-rates-add" aria-label="Add rate">＋</button>
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
      const mode = btn.dataset.mode

      const startPress = (e) => {
        e.stopPropagation()
        e.preventDefault()
        isLongPress = false
        pressTimer = setTimeout(() => {
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

      const endPress = (e) => {
        e.stopPropagation()
        if (pressTimer) {
          clearTimeout(pressTimer)
          pressTimer = null
        }
        if (!isLongPress) {
          const id = btn.dataset.rateAction
          if (mode === 'maintain') {
            const result = storage.add(id)
            if (!result) return
            showToast('Topped up +1')
          } else {
            const result = storage.consume(id)
            if (!result) return
            showToast('Used −1')
          }
        }
        isLongPress = false
      }

      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer)
          pressTimer = null
        }
        isLongPress = false
      }

      btn.addEventListener('mousedown', startPress)
      btn.addEventListener('touchstart', startPress)
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
    container.querySelectorAll('.rates-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.rates-mode-btn').forEach(b => b.classList.toggle('is-active', b === btn))
        if (hint) {
          hint.textContent = btn.dataset.mode === 'maintain'
            ? 'Tokens decay over time. Tap +1 to top up; long-press to spend 1.'
            : 'Tokens refill over time up to the cap. Tap −1 to spend; long-press to add +1.'
        }
      })
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
