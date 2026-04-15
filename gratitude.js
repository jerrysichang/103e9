import { gratitudeStorage, suppressRemoteRender } from './storage.js'
import { makeSortable }      from './sortable.js'

// ─── Journal Prompts ──────────────────────────────────────────────────────

const PROMPTS = [
  { key: 'why',      question: 'Why do you want this?' },
  { key: 'hard',     question: "What's hard about not having it?" },
  { key: 'good',     question: "What would be so good about it?" },
  { key: 'daily',    question: 'What would change day-to-day?' },
  { key: 'fear',     question: 'What if you never get it?' },
  { key: 'letter',   question: 'Write to your future self.' },
]

// ─── Icons ────────────────────────────────────────────────────────────────

const ICONS = {
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
          <div class="header-left">
            <button class="btn btn-icon menu-grid-btn" id="btn-home-list" aria-label="Menu"><span class="menu-grid-icon" aria-hidden="true"></span></button>
            <div class="header-title">Gratitude</div>
          </div>
          <div class="header-right">
            <button class="btn btn-icon" id="btn-add" aria-label="Add item">+</button>
          </div>
        </header>

        <div class="scroll">
          <!-- Achieved section -->
          <div class="section-header">
            <span class="section-label">Achieved</span>
            <span class="section-count">${achieved.length}</span>
          </div>

          <ul class="item-list gratitude-lines" id="list-achieved">
            ${achieved.length === 0 ? renderEmpty('Your achievements will appear here') : achieved.map(i => renderItem(i, true)).join('')}
          </ul>

          <!-- Pursuing section -->
          <div class="section-header" style="margin-top:12px">
            <span class="section-label">Pursuing</span>
            <span class="section-count">${pursuing.length}</span>
          </div>

          <ul class="item-list gratitude-lines" id="list-pursuing">
            ${pursuing.length === 0 ? renderEmpty('Nothing yet — tap + to add your first goal') : pursuing.map(renderItem).join('')}
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
        suppressRemoteRender()
        gratitudeStorage.reorder(ids, false)
      }, { handleSelector: '[data-sort-handle]' })
    }
    if (achieved.length > 1) {
      achievedSortable = makeSortable(achievedList, ids => {
        suppressRemoteRender()
        gratitudeStorage.reorder(ids, true)
      }, { handleSelector: '[data-sort-handle]' })
    }
  }

  render()
}

function renderItem(item, isAchieved = false) {
  return `
    <li
      class="item gratitude-item${isAchieved ? ' achieved-item' : ''}"
      data-sort-id="${item.id}"
      data-sort-handle
      data-id="${item.id}"
    >
      <div class="item-body" data-open="${item.id}">
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

  root.querySelector('#btn-home-list').addEventListener('click', () => navigate('home'))

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
            <button class="btn btn-icon menu-grid-btn" id="btn-home-detail" aria-label="Menu"><span class="menu-grid-icon" aria-hidden="true"></span></button>
          </div>
        </header>

        <div class="scroll">
          <div class="detail-hero">
            <div class="detail-title-wrap">
              <textarea
                class="detail-title${item.achieved ? ' achieved-title' : ''}"
                id="detail-title-input"
                placeholder="Goal title"
                maxlength="120"
                rows="1"
                autocomplete="off"
              >${escHtml(item.title)}</textarea>
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

          <div class="danger-zone">
            <button class="btn btn-danger" id="btn-delete">Delete Goal</button>
          </div>
        </div>
      </div>
    `

    bindDetailEvents(navigate, render, item)
  }

  render()
}

function renderPrompt(prompt, item) {
  const entries = gratitudeStorage.getPromptEntries(item, prompt.key)
  const entryMarkup = entries.length > 0
    ? entries.map((entry, index) => `
      <button class="btn prompt-entry-block" data-edit-entry="${prompt.key}|${entry.id}" type="button">
        <span class="prompt-entry-index">${index + 1}.</span>
        <span class="prompt-entry-text">${escHtml(entry.text)}</span>
      </button>
    `).join('')
    : `<p class="prompt-empty">No entries yet. Add a line when this prompt comes up for you.</p>`

  return `
    <div class="prompt-item">
      <div class="prompt-question">${prompt.question}</div>
      <div class="prompt-entries">
        ${entryMarkup}
      </div>
      <button class="btn btn-secondary prompt-add-line" data-add-line="${prompt.key}" type="button">+ Add line</button>
    </div>
  `
}

function bindDetailEvents(navigate, rerender, item) {
  const root = document.getElementById('view-detail')
  if (!root) return

  // Back
  root.querySelector('#btn-back').addEventListener('click', () => navigate('list'))
  root.querySelector('#btn-home-detail').addEventListener('click', () => navigate('home'))

  // Title save on blur / enter
  const titleInput = root.querySelector('#detail-title-input')
  const saveTitle = () => {
    const val = titleInput.value.trim()
    if (val && val !== item.title) {
      gratitudeStorage.update(item.id, { title: val })
    }
  }
  autoResize(titleInput)
  titleInput.addEventListener('input', () => autoResize(titleInput))
  titleInput.addEventListener('blur', saveTitle)
  titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); titleInput.blur() } })

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

  // Add new line to prompt (open drawer)
  root.querySelectorAll('[data-add-line]').forEach(btn => {
    btn.addEventListener('click', () => {
      const promptKey = btn.dataset.addLine
      if (!promptKey) return
      openPromptDrawer({
        title: 'New entry',
        initialText: '',
        onSave: (text) => {
          const entry = gratitudeStorage.addPromptEntry(item.id, promptKey)
          if (!entry) return
          gratitudeStorage.updatePromptEntry(item.id, promptKey, entry.id, text)
          rerender()
        },
      })
    })
  })

  // Edit existing line (open drawer)
  root.querySelectorAll('[data-edit-entry]').forEach(btn => {
    btn.addEventListener('click', () => {
      const parts = String(btn.dataset.editEntry || '').split('|')
      if (parts.length !== 2) return
      const [promptKey, entryId] = parts
      const currentItem = gratitudeStorage.getById(item.id)
      if (!currentItem) return
      const existing = gratitudeStorage.getPromptEntries(currentItem, promptKey).find(e => e.id === entryId)
      if (!existing) return
      openPromptDrawer({
        title: 'Edit entry',
        initialText: existing.text,
        onSave: (text) => {
          gratitudeStorage.updatePromptEntry(item.id, promptKey, entryId, text)
          rerender()
        },
        onDelete: () => {
          gratitudeStorage.deletePromptEntry(item.id, promptKey, entryId)
          rerender()
        },
      })
    })
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function autoResize(ta) {
  ta.style.height = 'auto'
  ta.style.height = ta.scrollHeight + 'px'
}

function openPromptDrawer({ title, initialText, onSave, onDelete }) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = `
    <div class="modal-backdrop" id="prompt-entry-modal">
      <div class="modal">
        <div class="modal-handle"></div>
        <div class="modal-title">${escHtml(title)}</div>
        <textarea class="input prompt-answer-drawer" id="prompt-entry-input" rows="6" placeholder="Write your thoughts…">${escHtml(initialText || '')}</textarea>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="prompt-entry-cancel">Cancel</button>
          ${onDelete ? `<button class="btn btn-danger" type="button" id="prompt-entry-delete">Delete</button>` : ''}
          <button class="btn btn-primary" type="button" id="prompt-entry-save">Save</button>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(wrapper)
  const modal = wrapper.querySelector('#prompt-entry-modal')
  const input = wrapper.querySelector('#prompt-entry-input')

  function close() {
    wrapper.remove()
  }

  wrapper.querySelector('#prompt-entry-cancel')?.addEventListener('click', close)
  wrapper.querySelector('#prompt-entry-save')?.addEventListener('click', () => {
    const text = String(input?.value || '').trim()
    if (!text) return
    onSave(text)
    close()
  })
  wrapper.querySelector('#prompt-entry-delete')?.addEventListener('click', () => {
    if (!confirm('Delete this entry?')) return
    onDelete?.()
    close()
  })
  modal?.addEventListener('click', e => {
    if (e.target === modal) close()
  })

  setTimeout(() => {
    input?.focus()
    if (input) input.setSelectionRange(input.value.length, input.value.length)
  }, 30)
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
