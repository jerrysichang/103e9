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
import { renderCoachChat, renderCoachProfile } from './coach.js'
import { renderDietTracker, renderDietGoals } from './diet.js'
import { renderIssuesList } from './issues.js'
import { renderChallenges } from './challenges.js'
import { renderCitibike } from './citibike.js'
import { renderBars } from './bars.js'
import { onRemoteUpdate, handleRemoteData } from './storage.js'
import { hasPassphrase, getPassphrase, connect, disconnect } from './firebase-sync.js'

// ─── Tool Registry ────────────────────────────────────────────────────────

const TOOLS = [
  {
    id:          'gratitude',
    name:        'Gratitude',
    description: 'Track goals and reflect on what you\'ve achieved',
    icon:        '✦',
    defaultView: 'list',
  },
  {
    id:          'coach',
    name:        'Coach',
    description: 'A personal coach that knows your life and learns over time',
    icon:        '◈',
    defaultView: 'coach-chat',
  },
  {
    id:          'diet',
    name:        'Fuel',
    description: 'Log meals, track macros and calories against daily goals',
    icon:        '◎',
    defaultView: 'diet',
  },
  {
    id:          'challenges',
    name:        'Challenges',
    description: 'Generate and complete mini challenges by topic',
    icon:        '△',
    defaultView: 'challenges',
  },
  {
    id:          'issues',
    name:        'Changes',
    description: 'Track fixes and changes for 103e3',
    icon:        '□',
    defaultView: 'issues',
  },
  {
    id:          'citibike',
    name:        'Citibike',
    description: 'Check bike and dock availability at NYC stations',
    icon:        '◉',
    defaultView: 'citibike',
  },
  {
    id:          'bars',
    name:        'Bars',
    description: 'Map nearby bars and see how busy they are right now',
    icon:        '◐',
    defaultView: 'bars',
  },
]

// ─── Router ───────────────────────────────────────────────────────────────

let currentRoute = null
const root = document.getElementById('root')

/**
 * Navigate to a view.
 * @param {string} view  - e.g. 'home' | 'list' | 'detail' | 'passphrase'
 * @param {object} params
 */
function navigate(view, params = {}) {
  currentRoute = { view, params }
  renderApp()
}

// ─── Remote update handling ──────────────────────────────────────────────

onRemoteUpdate(() => {
  // Re-render current view when remote data arrives
  if (currentRoute && (
    currentRoute.view === 'list' ||
    currentRoute.view === 'detail' ||
    currentRoute.view === 'diet' ||
    currentRoute.view === 'diet-goals' ||
    currentRoute.view === 'issues' ||
    currentRoute.view === 'challenges'
  )) {
    renderApp()
  }
})

// ─── Render ───────────────────────────────────────────────────────────────

function renderApp() {
  const { view, params } = currentRoute

  root.innerHTML = `<div class="app"></div>`
  const app = root.querySelector('.app')

  if (view === 'passphrase') {
    renderPassphrase(app)
    return
  }

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

  // Coach views
  if (view === 'coach-chat') {
    renderCoachChat(app, { navigate })
    return
  }

  if (view === 'coach-profile') {
    renderCoachProfile(app, { navigate })
    return
  }

  if (view === 'diet') {
    renderDietTracker(app, { navigate })
    return
  }

  if (view === 'diet-goals') {
    renderDietGoals(app, { navigate })
    return
  }

  if (view === 'issues') {
    renderIssuesList(app, { navigate })
    return
  }

  if (view === 'challenges') {
    renderChallenges(app, { navigate })
    return
  }

  if (view === 'citibike') {
    renderCitibike(app, { navigate })
    return
  }

  if (view === 'bars') {
    renderBars(app, { navigate })
    return
  }
}

// ─── Passphrase Screen ──────────────────────────────────────────────────

function renderPassphrase(container) {
  container.innerHTML = `
    <div class="view">
      <div class="scroll" style="display:flex;flex-direction:column;justify-content:center;min-height:100%">
        <div style="padding:0 28px">
          <div class="passphrase-eyebrow">Personal Tools</div>
          <h1 class="passphrase-title">Enter your<br>sync phrase</h1>
          <p class="passphrase-desc">Use the same phrase on all your devices to keep everything in sync.</p>
          <input
            class="input passphrase-input"
            id="passphrase-input"
            type="text"
            placeholder="Your secret phrase"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
          />
          <button class="btn btn-primary" id="btn-connect" style="margin-top:16px">Connect</button>
          <p class="passphrase-hint">This phrase is hashed — we never store it in the cloud.</p>
        </div>
      </div>
    </div>
  `

  const input = container.querySelector('#passphrase-input')
  const btn = container.querySelector('#btn-connect')

  async function doConnect() {
    const phrase = input.value.trim()
    if (!phrase) {
      input.focus()
      return
    }

    btn.textContent = 'Connecting...'
    btn.style.opacity = '0.5'

    try {
      await connect(phrase, handleRemoteData)
      // Go to the app
      if (TOOLS.length === 1) {
        navigate(TOOLS[0].defaultView)
      } else {
        navigate('home')
      }
    } catch (err) {
      console.error('Connection failed:', err)
      btn.textContent = 'Connect'
      btn.style.opacity = '1'
    }
  }

  btn.addEventListener('click', doConnect)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doConnect()
  })

  setTimeout(() => input.focus(), 100)
}

// ─── Home Screen (shown when multiple tools exist) ────────────────────────

function renderHome(container) {
  container.innerHTML = `
    <div class="view">
      <div class="scroll">
        <div class="home-header">
          <h1 class="home-title">103e9</h1>
          <div style="margin-top:14px">
            <button class="btn btn-secondary" id="btn-logout">Logout this device</button>
          </div>
        </div>
        <div class="tools-grid">
          ${TOOLS.map(tool => `
            <div class="tool-card ${tool.id === 'issues' ? 'tool-card-changes' : ''}" data-tool="${tool.id}">
              <div class="tool-card-icon">${tool.icon}</div>
              <div class="tool-card-name">${tool.name}</div>
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

  container.querySelector('#btn-logout')?.addEventListener('click', () => {
    if (!confirm('Logout on this device?')) return
    disconnect()
    navigate('passphrase')
  })
}

// ─── Viewport height (iOS home-screen / PWA) ─────────────────────────────
// 100dvh can exceed the visible area when launched from the home screen,
// leaving a dead strip under bottom chrome and clipping scroll content.

function bindAppViewportHeight() {
  const update = () => {
    const vv = window.visualViewport
    const inner = window.innerHeight
    let height = inner
    let top = 0

    if (vv) {
      top = Math.max(0, Math.round(vv.offsetTop))
      // visualViewport.height tracks the visible area; innerHeight can stay
      // taller when iOS chrome shifts, which leaves an intermittent dead strip.
      height = Math.round(Math.min(inner, vv.height + vv.offsetTop))
    }

    document.documentElement.style.setProperty('--app-vh', `${height}px`)
    document.documentElement.style.setProperty('--app-vv-top', `${top}px`)
  }
  update()
  window.addEventListener('resize', update, { passive: true })
  window.addEventListener('orientationchange', () => setTimeout(update, 150), { passive: true })
  window.addEventListener('pageshow', update, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update()
  })
  window.visualViewport?.addEventListener('resize', update, { passive: true })
  window.visualViewport?.addEventListener('scroll', update, { passive: true })
}

bindAppViewportHeight()

// ─── Boot ─────────────────────────────────────────────────────────────────

async function boot() {
  if (hasPassphrase()) {
    // Already connected before — reconnect silently
    try {
      await connect(getPassphrase(), handleRemoteData)
    } catch (err) {
      console.warn('Auto-reconnect failed, continuing with local data:', err)
    }

    if (TOOLS.length === 1) {
      navigate(TOOLS[0].defaultView)
    } else {
      navigate('home')
    }
  } else {
    // First time — show passphrase screen
    navigate('passphrase')
  }
}

boot()
