import { issueStorage } from './storage.js'

export function renderIssuesList(container, { navigate }) {
  function getIssues() {
    const all = issueStorage.getAll()
    const open = all.filter(item => !item.completed).sort((a, b) => a.order - b.order)
    const completed = all.filter(item => item.completed).sort((a, b) => a.order - b.order)
    return { open, completed }
  }

  function render() {
    const { open, completed } = getIssues()
    container.innerHTML = `
      <div class="view" id="view-issues">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-back" id="btn-home-issues">Menu</button>
            <div class="header-title">Issues</div>
          </div>
          <div class="header-right">
            <button class="btn btn-secondary issues-export-btn" type="button" id="btn-export-cursor">Save for Cursor</button>
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
          <ul class="item-list">
            ${open.length ? open.map(renderIssue).join('') : renderEmpty('No open issues')}
          </ul>

          <div class="section-header" style="margin-top:12px">
            <span class="section-label">Completed</span>
            <span class="section-count">${completed.length}</span>
          </div>
          <ul class="item-list">
            ${completed.length ? completed.map(renderIssue).join('') : renderEmpty('Nothing completed yet')}
          </ul>
        </div>
      </div>
    `

    bindEvents(navigate, render)
  }

  render()
}

function renderIssue(issue) {
  return `
    <li class="item issue-item ${issue.completed ? 'issue-completed' : ''}">
      <div class="item-body">
        <label class="issue-check-wrap">
          <input class="issue-check" type="checkbox" data-issue-toggle="${issue.id}" ${issue.completed ? 'checked' : ''}>
          <span class="issue-check-ui">${issue.completed ? '✓' : ''}</span>
        </label>
        <span class="item-title issue-title">${escHtml(issue.text)}</span>
      </div>
    </li>
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

  root.querySelector('#btn-export-cursor').addEventListener('click', () => {
    downloadOpenIssuesForCursor()
  })

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

  root.querySelectorAll('[data-issue-toggle]').forEach(inputEl => {
    inputEl.addEventListener('change', () => {
      issueStorage.setCompleted(inputEl.dataset.issueToggle, inputEl.checked)
      rerender()
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

/** Same shape as `scripts/export-open-issues.mjs` so Cursor can read either source. */
function downloadOpenIssuesForCursor() {
  const all = issueStorage.getAll()
  const open = all
    .filter(item => !item.completed)
    .sort((a, b) => a.order - b.order)
    .map(issue => ({
      id: issue.id,
      text: issue.text,
      createdAt: issue.createdAt || null,
      updatedAt: issue.updatedAt || null,
    }))
  const payload = {
    source: 'app-local',
    exportedAt: new Date().toISOString(),
    totalOpen: open.length,
    openIssues: open,
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'open-issues.json'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
