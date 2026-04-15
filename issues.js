import { issueStorage } from './storage.js'

export function renderIssuesList(container, { navigate }) {
  function getIssues() {
    const all = issueStorage.getAll()
    const open = all.filter(item => item.status === 'open').sort((a, b) => a.order - b.order)
    const checking = all.filter(item => item.status === 'checking').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    const complete = all
      .filter(item => item.status === 'complete')
      .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime())
      .slice(0, 20)
    return { open, checking, complete }
  }

  function render() {
    const { open, checking, complete } = getIssues()
    container.innerHTML = `
      <div class="view" id="view-issues">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-icon menu-grid-btn" id="btn-home-issues" aria-label="Menu"><span class="menu-grid-icon" aria-hidden="true"></span></button>
            <div class="header-title">Changes</div>
          </div>
        </header>

        <div class="scroll">
          <div class="issues-add-wrap">
            <input
              class="input issues-add-input"
              id="issue-input"
              type="text"
              maxlength="200"
              placeholder="Add change or fix for 103e3"
              autocomplete="off"
            />
            <button class="btn btn-primary issues-add-btn" id="btn-add-issue">Save</button>
          </div>

          <div class="section-header">
            <span class="section-label">Open</span>
            <span class="section-count">${open.length}</span>
          </div>
          <ul class="item-list" id="issues-open-list">
            ${open.length ? open.map(issue => renderIssue(issue, 'open')).join('') : renderEmpty('No open issues')}
          </ul>

          <div class="section-header" style="margin-top:12px">
            <span class="section-label">Checking</span>
            <span class="section-count">${checking.length}</span>
          </div>
          <ul class="item-list" id="issues-checking-list">
            ${checking.length ? checking.map(issue => renderIssue(issue, 'checking')).join('') : renderEmpty('Nothing in checking')}
          </ul>

          <div class="section-header" style="margin-top:12px">
            <span class="section-label">Recently Complete</span>
            <span class="section-count">${complete.length}</span>
          </div>
          <ul class="item-list" id="issues-done-list">
            ${complete.length ? complete.map(issue => renderIssue(issue, 'complete')).join('') : renderEmpty('Nothing completed yet')}
          </ul>
        </div>
      </div>
    `

    bindEvents(navigate, render)
  }

  render()
}

function renderIssue(issue, section) {
  if (section === 'open') {
    return `
      <li class="item issue-item" data-sort-id="${issue.id}">
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
          <label class="issue-check-wrap">
            <input class="issue-check" type="checkbox" data-issue-complete="${issue.id}">
            <span class="issue-check-ui"></span>
          </label>
          <span class="item-title issue-title">${escHtml(issue.text)}</span>
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

  const input = root.querySelector('#issue-input')
  const addBtn = root.querySelector('#btn-add-issue')

  const addIssue = () => {
    const text = input.value.trim()
    if (!text) return
    issueStorage.create(text)
    input.value = ''
    rerender()
  }

  addBtn.addEventListener('click', addIssue)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addIssue()
  })

  root.querySelectorAll('[data-issue-complete]').forEach(inputEl => {
    inputEl.addEventListener('change', () => {
      issueStorage.setStatus(inputEl.dataset.issueComplete, 'complete')
      rerender()
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
  setTimeout(() => input?.focus(), 30)
}
