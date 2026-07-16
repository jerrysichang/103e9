const KEY = 'ps_rates_v1'
const DAY_MS = 24 * 60 * 60 * 1000

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

function normalizeTracker(t) {
  const rateAmount = Math.max(0.01, Number(t.rateAmount) || 1)
  const rateDays = Math.max(0.01, Number(t.rateDays) || 1)
  const cap = Math.max(1, Number(t.cap) || 1)
  const balance = Math.max(0, Number(t.balance) || 0)
  const lastTickAt = Number(t.lastTickAt) || Date.now()
  return {
    id: String(t.id),
    name: String(t.name || '').trim() || 'Untitled',
    rateAmount,
    rateDays,
    cap,
    balance: Math.min(cap, balance),
    lastTickAt,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || new Date().toISOString(),
    log: Array.isArray(t.log) ? t.log : [],
  }
}

function currentBalance(t, now = Date.now()) {
  if (t.balance >= t.cap) return t.cap
  const tokensPerMs = t.rateAmount / (t.rateDays * DAY_MS)
  const gained = Math.max(0, now - t.lastTickAt) * tokensPerMs
  return Math.min(t.cap, t.balance + gained)
}

function settleTracker(t, now = Date.now()) {
  const balance = currentBalance(t, now)
  return { ...t, balance, lastTickAt: now, updatedAt: new Date(now).toISOString() }
}

function progressToNextToken(t, now = Date.now()) {
  const bal = currentBalance(t, now)
  if (bal >= t.cap) return { atCap: true, progress: 1, msUntilNext: null, nextLabel: 'At cap' }

  const nextWhole = Math.min(t.cap, Math.floor(bal) + 1)
  const need = Math.max(0, nextWhole - bal)
  const tokensPerMs = t.rateAmount / (t.rateDays * DAY_MS)
  const msUntilNext = need / tokensPerMs
  const progress = bal - Math.floor(bal)
  return {
    atCap: false,
    progress,
    msUntilNext,
    nextLabel: `Next in ${formatDuration(msUntilNext)}`,
    nextWhole,
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

function formatRate(t) {
  const amount = Number.isInteger(t.rateAmount) ? String(t.rateAmount) : String(t.rateAmount)
  const days = Number.isInteger(t.rateDays) ? String(t.rateDays) : String(t.rateDays)
  const unit = t.rateDays === 1 ? 'day' : 'days'
  return `${amount} / ${days} ${unit}`
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

    create({ name, rateAmount, rateDays, cap }) {
      const state = loadState()
      const now = Date.now()
      const tracker = normalizeTracker({
        id: crypto.randomUUID(),
        name,
        rateAmount,
        rateDays,
        cap,
        balance: 0,
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
      // Re-clamp after rate/cap edits
      next.balance = Math.min(next.cap, Math.max(0, next.balance))
      state.trackers[idx] = next
      this._write(state.trackers)
      return next
    },

    remove(id) {
      const state = loadState()
      state.trackers = state.trackers.filter(t => t.id !== id)
      this._write(state.trackers)
    },

    /** Spend one token if available. Returns updated tracker or null if none left. */
    consume(id) {
      const state = loadState()
      const idx = state.trackers.findIndex(t => t.id === id)
      if (idx === -1) return null
      const settled = settleTracker(normalizeTracker(state.trackers[idx]))
      if (settled.balance < 1 - 1e-9) return { tracker: settled, ok: false }
      const now = Date.now()
      const next = {
        ...settled,
        balance: Math.max(0, settled.balance - 1),
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
  }
}

const storage = ratesStorage()

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
    const rateAmount = Number(root.querySelector('#rates-amount')?.value)
    const rateDays = Number(root.querySelector('#rates-days')?.value)
    const cap = Number(root.querySelector('#rates-cap')?.value)
    if (!name) return { error: 'Give it a name.' }
    if (!Number.isFinite(rateAmount) || rateAmount <= 0) return { error: 'Rate amount must be greater than 0.' }
    if (!Number.isFinite(rateDays) || rateDays <= 0) return { error: 'Period must be greater than 0 days.' }
    if (!Number.isFinite(cap) || cap < 1) return { error: 'Cap must be at least 1.' }
    return { name, rateAmount, rateDays, cap: Math.floor(cap) }
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
    const whole = Math.floor(bal + 1e-9)
    const prog = progressToNextToken(t)
    const canLog = bal >= 1 - 1e-9
    const barPct = prog.atCap ? 100 : Math.round(prog.progress * 100)

    return `
      <li class="rates-card" data-tracker-id="${t.id}">
        <button type="button" class="rates-card-main" data-edit-tracker="${t.id}">
          <div class="rates-card-top">
            <span class="rates-card-name item-title">${escapeHtml(t.name)}</span>
            <span class="rates-card-balance">${formatBalance(bal)}</span>
          </div>
          <div class="rates-card-meta text-body-sm">
            <span>${whole === 1 ? '1 token' : `${whole} tokens`} left</span>
            <span class="rates-card-dot">·</span>
            <span>${escapeHtml(prog.nextLabel)}</span>
          </div>
          <div class="rates-progress" aria-hidden="true">
            <div class="rates-progress-fill" style="width:${barPct}%"></div>
          </div>
          <div class="rates-card-footer text-body-sm">
            <span>${escapeHtml(formatRate(t))}</span>
            <span class="rates-card-dot">·</span>
            <span>cap ${t.cap}</span>
          </div>
        </button>
        <button
          type="button"
          class="btn btn-cta rates-log-btn"
          data-log-tracker="${t.id}"
          ${canLog ? '' : 'disabled'}
        >Log</button>
      </li>
    `
  }

  function renderModal() {
    if (!modalMode) return ''
    const existing = editingId ? storage.get(editingId) : null
    const isEdit = modalMode === 'edit' && existing
    const title = isEdit ? 'Edit rate' : 'New rate'
    const name = isEdit ? existing.name : ''
    const rateAmount = isEdit ? existing.rateAmount : 1
    const rateDays = isEdit ? existing.rateDays : 3
    const cap = isEdit ? existing.cap : 5

    return `
      <div class="modal-backdrop" id="rates-modal">
        <div class="modal rates-modal">
          <div class="modal-handle"></div>
          <div class="modal-title">${title}</div>
          <label class="rates-field">
            <span class="rates-field-label">Name</span>
            <input class="input" id="rates-name" type="text" maxlength="80" placeholder="e.g. Drinks" value="${escapeHtml(name)}" autocomplete="off" />
          </label>
          <div class="rates-field-row">
            <label class="rates-field">
              <span class="rates-field-label">Tokens</span>
              <input class="input" id="rates-amount" type="number" min="0.01" step="any" inputmode="decimal" value="${rateAmount}" />
            </label>
            <span class="rates-field-join">per</span>
            <label class="rates-field">
              <span class="rates-field-label">Days</span>
              <input class="input" id="rates-days" type="number" min="0.01" step="any" inputmode="decimal" value="${rateDays}" />
            </label>
          </div>
          <label class="rates-field">
            <span class="rates-field-label">Max tokens (cap)</span>
            <input class="input" id="rates-cap" type="number" min="1" step="1" inputmode="numeric" value="${cap}" />
          </label>
          <p class="diet-modal-hint">Tokens refill over time up to the cap. Logging spends 1 token.</p>
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

    container.innerHTML = `
      <div class="view" id="view-rates">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-icon menu-grid-btn header-menu-btn" id="btn-rates-home" aria-label="Menu">
              <span class="menu-grid-icon" aria-hidden="true"></span>
            </button>
          </div>
          <div class="header-title">Rates</div>
        </header>

        <div class="scroll">
          ${trackers.length === 0 ? `
            <div class="empty-state rates-empty">
              <p>Track anything with a refill rate — drinks, treats, check-ins.</p>
              <p class="text-body-sm" style="color:var(--text-secondary);margin-top:8px">Example: 1 drink every 3 days, capped at 5.</p>
            </div>
          ` : `
            <ul class="rates-list">
              ${trackers.map(renderCard).join('')}
            </ul>
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

    container.querySelectorAll('[data-edit-tracker]').forEach(btn => {
      btn.addEventListener('click', () => openEdit(btn.dataset.editTracker))
    })

    container.querySelectorAll('[data-log-tracker]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const id = btn.dataset.logTracker
        const result = storage.consume(id)
        if (!result?.ok) {
          showToast('No tokens left yet')
          return
        }
        showToast('Logged −1')
      })
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
