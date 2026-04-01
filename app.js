/**
 * Personal Tools — App Shell
 *
 * Adding a new tool:
 *  1. Import its render functions
 *  2. Add an entry to the TOOLS array
 *  3. Add cases to navigate() if it needs sub-views
 *
 * When there is only one tool, the home screen is skipped.
 */

import { renderGratitudeList, renderGratitudeDetail } from './gratitude.js'

// ─── Tool Registry ────────────────────────────────────────────────────────

const TOOLS = [
  {
    id:          'gratitude',
    name:        'Gratitude',
    description: 'Track goals and reflect on what you\'ve achieved',
    icon:        '✦',
    defaultView: 'list',
  },
  // Add more tools here — a home screen will appear automatically.
  // Example:
  // {
  //   id:          'journal',
  //   name:        'Journal',
  //   description: 'Daily reflection and writing',
  //   icon:        '✎',
  //   defaultView: 'entries',
  // },
]

// ─── Router ───────────────────────────────────────────────────────────────

let currentRoute = null
const root = document.getElementById('root')

/**
 * Navigate to a view.
 * @param {string} view  - e.g. 'home' | 'list' | 'detail'
 * @param {object} params
 */
function navigate(view, params = {}) {
  currentRoute = { view, params }
  renderApp()
}

// ─── Render ───────────────────────────────────────────────────────────────

function renderApp() {
  const { view, params } = currentRoute

  root.innerHTML = `<div class="app"></div>`
  const app = root.querySelector('.app')

  if (view === 'home') {
    renderHome(app)
    return
  }

  // Gratitude views
  if (view === 'list') {
    renderGratitudeList(app, { navigate })
    return
  }

  if (view === 'detail') {
    renderGratitudeDetail(app, { navigate, itemId: params.itemId })
    return
  }
}

// ─── Home Screen (shown when multiple tools exist) ────────────────────────

function renderHome(container) {
  container.innerHTML = `
    <div class="view">
      <div class="scroll">
        <div class="home-header">
          <div class="home-eyebrow">Personal</div>
          <h1 class="home-title">Tools</h1>
        </div>
        <div class="tools-grid">
          ${TOOLS.map(tool => `
            <div class="tool-card" data-tool="${tool.id}">
              <div class="tool-card-icon">${tool.icon}</div>
              <div class="tool-card-name">${tool.name}</div>
              <div class="tool-card-desc">${tool.description}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `

  container.querySelector('.tools-grid').addEventListener('click', e => {
    const card = e.target.closest('[data-tool]')
    if (!card) return
    const tool = TOOLS.find(t => t.id === card.dataset.tool)
    if (tool) navigate(tool.defaultView)
  })
}

// ─── Boot ─────────────────────────────────────────────────────────────────

function boot() {
  // If there's only one tool, skip home and go straight to it
  if (TOOLS.length === 1) {
    navigate(TOOLS[0].defaultView)
  } else {
    navigate('home')
  }
}

boot()
