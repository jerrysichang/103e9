import { issueStorage, suppressRemoteRender } from './storage.js'
import { makeSortable } from './sortable.js'
import { getCurrentTheme, toggleTheme } from './theme.js'
import { bottomChrome, gridMenuFab, textFab } from './chrome.js'

export function renderIssuesList(container, { navigate }) {
  let openSortable = null

  function getIssues() {
    const all = issueStorage.getAll()
    const open = all.filter(item => item.status === 'open').sort((a, b) => a.order - b.order)
    const checking = all.filter(item => item.status === 'checking').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    const complete = all
      .filter(item => item.status === 'complete')
      .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime())
      .slice(0, 10)
    return { open, checking, complete }
  }

  function render() {
    if (openSortable) openSortable.destroy()
    const { open, checking, complete } = getIssues()
    container.innerHTML = `
      <div class="view" id="view-issues">
        <header class="header">
          <div class="header-left"></div>
          <div class="header-title">Changes</div>
          <div class="header-right">
            <button class="btn-icon theme-toggle" id="btn-theme-toggle" aria-label="Toggle theme"></button>
          </div>
        </header>

        <div class="scroll">
          <div class="section-header">
            <span class="section-label">Open</span>
            <span class="section-count">${open.length}</span>
          </div>
          <ul class="item-list issues-lines" id="issues-open-list">
            ${open.length ? open.map(issue => renderIssue(issue, 'open')).join('') : renderEmpty('No open issues')}
          </ul>

          <div class="section-header" style="margin-top:12px">
            <span class="section-label">Checking</span>
            <span class="section-count">${checking.length}</span>
          </div>
          <ul class="item-list issues-lines" id="issues-checking-list">
            ${checking.length ? checking.map(issue => renderIssue(issue, 'checking')).join('') : renderEmpty('Nothing in checking')}
          </ul>

          <div class="section-header" style="margin-top:12px">
            <span class="section-label">Recently Complete</span>
            <span class="section-count">${complete.length}</span>
          </div>
          <ul class="item-list issues-lines" id="issues-done-list">
            ${complete.length ? complete.map(issue => renderIssue(issue, 'complete')).join('') : renderEmpty('Nothing completed yet')}
          </ul>
        </div>
        ${bottomChrome({
          left: gridMenuFab('btn-home-issues'),
          right: textFab({ id: 'btn-add-issue-fab', label: 'Add' }),
        })}
      </div>
    `

    bindEvents(navigate, render)
    const openList = container.querySelector('#issues-open-list')
    if (open.length > 1 && openList) {
      openSortable = makeSortable(openList, ids => {
        suppressRemoteRender()
        issueStorage.reorder(ids, false)
      }, { handleSelector: '[data-sort-handle]', holdDelayMs: 220 })
    }
  }

  render()
}

function renderIssue(issue, section) {
  if (section === 'open') {
    return `
      <li class="item issue-item" data-sort-id="${issue.id}" data-sort-handle>
        <div class="item-body">
          <span class="item-title issue-title" data-edit-issue="${issue.id}">${escHtml(issue.text)}</span>
        </div>
        <button class="btn issue-delete-btn" type="button" data-delete-issue="${issue.id}" aria-label="Delete issue">×</button>
      </li>
    `
  }
  if (section === 'checking') {
    return `
      <li class="item issue-item issue-checking" data-sort-id="${issue.id}">
        <div class="item-body">
          <span class="item-title issue-title">${escHtml(issue.text)}</span>
          <label class="issue-check-wrap issue-check-wrap-right">
            <input class="issue-check" type="checkbox" data-issue-complete="${issue.id}">
            <span class="issue-check-ui">✓</span>
          </label>
        </div>
      </li>
    `
  }
  return `
    <li class="item issue-item issue-completed" data-sort-id="${issue.id}">
      <div class="item-body">
        <span class="item-title issue-title">${escHtml(issue.text)}</span>
      </div>
    </li>
  `
}

function issueEditorModal(issue) {
  return `
    <div class="modal-backdrop" id="issue-editor-modal">
      <div class="modal">
        <div class="modal-handle"></div>
        <div class="modal-title">Edit Issue</div>
        <textarea class="input" id="issue-editor-input" rows="3" maxlength="200">${escHtml(issue.text)}</textarea>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="issue-editor-cancel">Cancel</button>
          <button class="btn btn-primary" type="button" id="issue-editor-save">Save</button>
        </div>
      </div>
    </div>
  `
}

function renderEmpty(message) {
  return `
    <li style="list-style:none">
      <div class="empty-state">
        <p>${message}</p>
      </div>
    </li>
  `
}

function bindEvents(navigate, rerender) {
  const root = document.getElementById('view-issues')
  if (!root) return

  root.querySelector('#btn-home-issues').addEventListener('click', () => navigate('home'))
  root.querySelector('#btn-add-issue-fab')?.addEventListener('click', () => openIssueCreator(rerender))

  // Theme toggle
  const themeBtn = root.querySelector('#btn-theme-toggle')
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

  root.querySelectorAll('[data-issue-complete]').forEach(inputEl => {
    inputEl.addEventListener('change', () => {
      const scrollEl = root.querySelector('.scroll')
      const prevTop = scrollEl?.scrollTop ?? 0
      issueStorage.setStatus(inputEl.dataset.issueComplete, 'complete')
      rerender()
      const restore = () => {
        const nextRoot = document.getElementById('view-issues')
        const nextScroll = nextRoot?.querySelector('.scroll')
        if (nextScroll) nextScroll.scrollTop = prevTop
      }
      requestAnimationFrame(() => {
        restore()
        requestAnimationFrame(restore)
      })
    })
  })

  root.querySelectorAll('[data-delete-issue]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.deleteIssue
      if (!id) return
      if (!confirm('Delete this issue?')) return
      issueStorage.delete(id)
      rerender()
    })
  })

  root.querySelectorAll('[data-edit-issue]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.editIssue
      if (!id) return
      const issue = issueStorage.getAll().find(item => item.id === id)
      if (!issue) return
      openIssueEditor(issue, rerender)
    })
  })
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function openIssueEditor(issue, rerender) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = issueEditorModal(issue)
  document.body.appendChild(wrapper)
  const modal = wrapper.querySelector('#issue-editor-modal')
  const input = wrapper.querySelector('#issue-editor-input')

  function close() {
    wrapper.remove()
  }

  wrapper.querySelector('#issue-editor-cancel')?.addEventListener('click', close)
  wrapper.querySelector('#issue-editor-save')?.addEventListener('click', () => {
    const text = String(input?.value || '').trim()
    if (!text) return
    issueStorage.updateText(issue.id, text)
    close()
    rerender()
  })
  modal?.addEventListener('click', e => {
    if (e.target === modal) close()
  })
  setTimeout(() => {
    input?.focus()
    input?.select()
  }, 30)
}

function openIssueCreator(rerender) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = `
    <div class="modal-backdrop" id="issue-create-modal">
      <div class="modal">
        <div class="modal-handle"></div>
        <div class="modal-title">New Change</div>
        <textarea class="input" id="issue-create-input" rows="3" maxlength="200" placeholder="Add change or fix for 103e3"></textarea>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="issue-create-cancel">Cancel</button>
          <button class="btn btn-primary" type="button" id="issue-create-save">Save</button>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(wrapper)
  const modal = wrapper.querySelector('#issue-create-modal')
  const input = wrapper.querySelector('#issue-create-input')

  function close() {
    wrapper.remove()
  }

  wrapper.querySelector('#issue-create-cancel')?.addEventListener('click', close)
  wrapper.querySelector('#issue-create-save')?.addEventListener('click', () => {
    const text = String(input?.value || '').trim()
    if (!text) return
    issueStorage.create(text)
    close()
    rerender()
  })
  modal?.addEventListener('click', e => {
    if (e.target === modal) close()
  })
  queueInputFocus(input)
}

/**
 * @param {HTMLTextAreaElement | null} input
 */
function queueInputFocus(input) {
  const focusNow = () => {
    if (!input) return
    input.focus({ preventScroll: true })
    input.select()
    const end = input.value.length
    input.setSelectionRange(0, end)
  }
  requestAnimationFrame(() => {
    focusNow()
    requestAnimationFrame(focusNow)
  })
}
