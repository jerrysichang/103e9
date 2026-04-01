import { gratitudeStorage } from './storage.js'
import { makeSortable }      from './sortable.js'

// ─── Journal Prompts ──────────────────────────────────────────────────────

const PROMPTS = [
  { key: 'why',       question: 'Why do you want this?' },
  { key: 'feeling',   question: 'What will it feel like when you achieve this?' },
  { key: 'important', question: 'Why is this important to you?' },
  { key: 'steps',     question: 'What steps are you taking toward this?' },
  { key: 'after',     question: 'What will you do when you achieve this?' },
  { key: 'obstacles', question: 'What obstacles might you face, and how will you overcome them?' },
  { key: 'grateful',  question: 'What are you already grateful for on this journey?' },
]

// ─── Icons ────────────────────────────────────────────────────────────────

const ICONS = {
  handle: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <line x1="3" y1="5" x2="13" y2="5"/>
    <line x1="3" y1="8" x2="13" y2="8"/>
    <line x1="3" y1="11" x2="13" y2="11"/>
  </svg>`,

  chevron: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="6 4 10 8 6 12"/>
  </svg>`,

  back: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="10 4 6 8 10 12"/>
  </svg>`,

  check: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="3 8 6.5 11.5 13 4.5"/>
  </svg>`,
}

// ─── List View ────────────────────────────────────────────────────────────

export function renderGratitudeList(container, { navigate }) {
  let pursuingSortable = null
  let achievedSortable = null

  function getItems() {
    const all = gratitudeStorage.getAll()
    const pursuing = all.filter(i => !i.achieved).sort((a, b) => a.order - b.order)
    const achieved = all.filter(i =>  i.achieved).sort((a, b) => a.order - b.order)
    return { pursuing, achieved }
  }

  function render() {
    if (pursuingSortable) pursuingSortable.destroy()
    if (achievedSortable) achievedSortable.destroy()

    const { pursuing, achieved } = getItems()

    container.innerHTML = `
      <div class="view" id="view-list">
        <header class="header">
          <div class="header-left"></div>
          <div>
            <div class="header-subtitle">Personal</div>
            <div class="header-title">Gratitude</div>
          </div>
          <div class="header-right">
            <button class="btn btn-icon" id="btn-add" aria-label="Add item">+</button>
          </div>
        </header>

        <div class="scroll">
          <!-- Pursuing section -->
          <div class="section-header">
            <span class="section-label">Pursuing</span>
            <span class="section-count">${pursuing.length}</span>
          </div>

          <ul class="item-list" id="list-pursuing">
            ${pursuing.length === 0 ? renderEmpty('Nothing yet — tap + to add your first goal') : pursuing.map(renderItem).join('')}
          </ul>

          <!-- Achieved section -->
          <div class="section-header" style="margin-top:12px">
            <span class="section-label">Achieved</span>
            <span class="section-count">${achieved.length}</span>
          </div>

          <ul class="item-list" id="list-achieved">
            ${achieved.length === 0 ? renderEmpty('Your achievements will appear here') : achieved.map(i => renderItem(i, true)).join('')}
          </ul>
        </div>

        <!-- Add modal (hidden by default) -->
        <div class="modal-backdrop hidden" id="add-modal">
          <div class="modal">
            <div class="modal-handle"></div>
            <div class="modal-title">New Goal</div>
            <input
              class="input"
              id="add-input"
              type="text"
              placeholder="What do you yearn for?"
              maxlength="120"
              autocomplete="off"
            />
            <div class="modal-actions">
              <button class="btn btn-secondary" id="btn-cancel">Cancel</button>
              <button class="btn btn-primary"   id="btn-save">Add</button>
            </div>
          </div>
        </div>
      </div>
    `

    bindListEvents(navigate, render)

    // Attach sortable to both lists
    const pursuingList = container.querySelector('#list-pursuing')
    const achievedList = container.querySelector('#list-achieved')

    if (pursuing.length > 1) {
      pursuingSortable = makeSortable(pursuingList, ids => {
        gratitudeStorage.reorder(ids, false)
      })
    }
    if (achieved.length > 1) {
      achievedSortable = makeSortable(achievedList, ids => {
        gratitudeStorage.reorder(ids, true)
      })
    }
  }

  render()
}

function renderItem(item, isAchieved = false) {
  return `
    <li
      class="item${isAchieved ? ' achieved-item' : ''}"
      data-sort-id="${item.id}"
      data-id="${item.id}"
    >
      <span class="item-handle" data-sort-handle aria-hidden="true">${ICONS.handle}</span>
      <div class="item-body" data-open="${item.id}">
        <span class="item-status-dot"></span>
        <span class="item-title">${escHtml(item.title)}</span>
      </div>
      <span class="item-chevron" data-open="${item.id}">${ICONS.chevron}</span>
    </li>
  `
}

function renderEmpty(msg) {
  return `
    <li style="list-style:none">
      <div class="empty-state">
        <p>${msg}</p>
      </div>
    </li>
  `
}

function bindListEvents(navigate, rerender) {
  const root = document.getElementById('view-list')
  if (!root) return

  // Open item
  root.addEventListener('click', e => {
    const opener = e.target.closest('[data-open]')
    if (opener) {
      navigate('detail', { itemId: opener.dataset.open })
    }
  })

  // Add modal
  const modal    = root.querySelector('#add-modal')
  const input    = root.querySelector('#add-input')
  const btnAdd   = root.querySelector('#btn-add')
  const btnSave  = root.querySelector('#btn-save')
  const btnCancel = root.querySelector('#btn-cancel')

  btnAdd.addEventListener('click', () => {
    modal.classList.remove('hidden')
    setTimeout(() => input.focus(), 50)
  })

  function closeModal() {
    modal.classList.add('hidden')
    input.value = ''
  }

  function saveItem() {
    const title = input.value.trim()
    if (!title) return
    gratitudeStorage.create(title)
    closeModal()
    rerender()
  }

  btnSave.addEventListener('click', saveItem)
  btnCancel.addEventListener('click', closeModal)

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveItem()
    if (e.key === 'Escape') closeModal()
  })

  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal()
  })
}

// ─── Detail View ──────────────────────────────────────────────────────────

export function renderGratitudeDetail(container, { navigate, itemId }) {
  let item = gratitudeStorage.getById(itemId)
  if (!item) { navigate('list'); return }

  function render() {
    item = gratitudeStorage.getById(itemId)
    if (!item) { navigate('list'); return }

    const achievedDate = item.achievedAt
      ? `Achieved ${formatDate(item.achievedAt)}`
      : `Added ${formatDate(item.createdAt)}`

    container.innerHTML = `
      <div class="view" id="view-detail">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-back" id="btn-back">
              ${ICONS.back} Back
            </button>
          </div>
          <div class="header-right">
            <button class="btn btn-icon" id="btn-delete" aria-label="Delete" style="color:var(--danger);font-size:16px;font-weight:400">✕</button>
          </div>
        </header>

        <div class="scroll">
          <div class="detail-hero">
            <div class="detail-title-wrap">
              <input
                class="detail-title${item.achieved ? ' achieved-title' : ''}"
                id="detail-title-input"
                type="text"
                value="${escHtml(item.title)}"
                placeholder="Goal title"
                maxlength="120"
                autocomplete="off"
              />
              <div class="detail-date">${achievedDate}</div>
            </div>

            <div class="detail-actions">
              ${item.achieved
                ? `<button class="btn btn-secondary" id="btn-toggle-achieved">↩ Still Pursuing</button>`
                : `<button class="btn btn-achieved" id="btn-toggle-achieved">✓ Mark Achieved</button>`
              }
            </div>
          </div>

          ${item.achieved ? `
            <div class="achieved-banner">
              <span class="achieved-banner-icon">✦</span>
              <span class="achieved-banner-text">You achieved this. Read what you wrote — you're living it now.</span>
            </div>
          ` : ''}

          <div class="prompts">
            ${PROMPTS.map(p => renderPrompt(p, item)).join('')}
          </div>
        </div>
      </div>
    `

    bindDetailEvents(navigate, render, item)
  }

  render()
}

function renderPrompt(prompt, item) {
  const answer = item.answers?.[prompt.key] || ''
  return `
    <div class="prompt-item">
      <div class="prompt-question">${prompt.question}</div>
      <textarea
        class="input prompt-answer"
        data-prompt-key="${prompt.key}"
        placeholder="Write your thoughts…"
        rows="1"
      >${escHtml(answer)}</textarea>
    </div>
  `
}

function bindDetailEvents(navigate, rerender, item) {
  const root = document.getElementById('view-detail')
  if (!root) return

  // Back
  root.querySelector('#btn-back').addEventListener('click', () => navigate('list'))

  // Title save on blur / enter
  const titleInput = root.querySelector('#detail-title-input')
  const saveTitle = () => {
    const val = titleInput.value.trim()
    if (val && val !== item.title) {
      gratitudeStorage.update(item.id, { title: val })
    }
  }
  titleInput.addEventListener('blur', saveTitle)
  titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') titleInput.blur() })

  // Toggle achieved
  root.querySelector('#btn-toggle-achieved').addEventListener('click', () => {
    saveTitle()
    gratitudeStorage.setAchieved(item.id, !item.achieved)
    rerender()
  })

  // Delete
  root.querySelector('#btn-delete').addEventListener('click', () => {
    if (confirm(`Delete "${item.title}"?`)) {
      gratitudeStorage.delete(item.id)
      navigate('list')
    }
  })

  // Prompt autosave + autoresize
  const textareas = root.querySelectorAll('textarea[data-prompt-key]')
  textareas.forEach(ta => {
    autoResize(ta)
    ta.addEventListener('input',  () => autoResize(ta))
    ta.addEventListener('change', () => {
      gratitudeStorage.updateAnswer(item.id, ta.dataset.promptKey, ta.value)
    })
    ta.addEventListener('blur', () => {
      gratitudeStorage.updateAnswer(item.id, ta.dataset.promptKey, ta.value)
    })
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function autoResize(ta) {
  ta.style.height = 'auto'
  ta.style.height = ta.scrollHeight + 'px'
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
