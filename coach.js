/**
 * Coach — personal life coach that knows your profile and learns over time.
 *
 * Setup: deploy cloudflare-worker.js to Cloudflare Workers, add your
 * ANTHROPIC_API_KEY secret, then set WORKER_URL below.
 */

import { getProfile, patchProfile } from './coach-profile.js'

// ─── Config ───────────────────────────────────────────────────────────────

const WORKER_URL = 'https://jos.jerry-si-chang.workers.dev'

// ─── Prompts ──────────────────────────────────────────────────────────────

const COACH_SYSTEM_PROMPT = `You are a personal life coach with deep context about the person you're advising. Their current profile is appended to every message — read it before responding. All current facts about their life are in that document.

How you operate:
- Be specific, not general. Reference real details from their profile.
- Notice cross-domain tensions — training affecting sleep, finances affecting career risk, overcommitment vs deadlines.
- Ask one sharp question, not five soft ones.
- No coaching clichés. Speak like a smart, direct friend with relevant expertise.
- Push back when something doesn't add up.`

const EXTRACTION_SYSTEM_PROMPT = `You extract profile updates from coaching conversations.

Given a conversation and the person's current profile, identify new facts, changed values, or updated status.

Return ONLY a valid JSON object with the fields that changed, using exact field names from the profile schema. Only include changed or newly revealed fields. If nothing changed, return {}.

Return only JSON. No explanation, no markdown, no preamble.`

// ─── Icons ────────────────────────────────────────────────────────────────

const ICONS = {
  back: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="10 4 6 8 10 12"/>
  </svg>`,

  profile: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="8" cy="5.5" r="2.5"/>
    <path d="M2.5 14c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5"/>
  </svg>`,

  chevronDown: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="4 6 8 10 12 6"/>
  </svg>`,

  chevronRight: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="6 4 10 8 6 12"/>
  </svg>`,
}

// ─── Profile domains ──────────────────────────────────────────────────────

const PROFILE_DOMAINS = [
  {
    key: 'personal',
    label: 'Personal',
    fields: ['location', 'life_stage', 'relationship_status', 'planning_horizon'],
  },
  {
    key: 'finance',
    label: 'Finance',
    fields: ['net_worth_approx', 'savings_rate', 'savings_rate_target', 'financial_goals', 'financial_notes'],
  },
  {
    key: 'health',
    label: 'Health',
    fields: ['active_training_goal', 'key_metrics', 'nutrition_approach', 'health_notes'],
  },
  {
    key: 'career',
    label: 'Career',
    fields: ['current_role', 'career_model', 'side_projects', 'key_frameworks', 'career_notes'],
  },
  {
    key: 'goals',
    label: 'Goals & Plans',
    fields: ['active_goals', 'fixed_deadlines', 'open_questions', 'additional_context'],
  },
]

// ─── Chat View ────────────────────────────────────────────────────────────

export function renderCoachChat(container, { navigate }) {
  let messages = []
  let isWaiting = false

  function render() {
    container.innerHTML = `
      <div class="view" id="view-coach-chat">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-back" id="btn-back-coach">
              ${ICONS.back} Back
            </button>
          </div>
          <div class="header-title">Coach</div>
          <div class="header-right">
            <button class="btn btn-icon" id="btn-coach-profile" aria-label="View profile">
              ${ICONS.profile}
            </button>
          </div>
        </header>

        <div class="coach-messages" id="coach-messages">
          <div class="coach-empty" id="coach-empty">
            <p>Start a conversation. Your coach knows your profile and remembers what you tell it.</p>
          </div>
        </div>

        <div class="coach-input-bar" id="coach-input-bar">
          <div class="coach-input-row">
            <textarea
              class="input coach-input"
              id="coach-input"
              placeholder="Message…"
              rows="1"
              autocomplete="off"
              spellcheck="true"
            ></textarea>
            <button class="btn btn-primary coach-send" id="coach-send">Send</button>
          </div>
          <div class="coach-actions-row">
            <button class="btn btn-secondary coach-end" id="coach-end">End session</button>
          </div>
        </div>

        <div class="coach-updating hidden" id="coach-updating">
          <div class="coach-updating-inner">
            <div class="coach-updating-text" id="coach-updating-text">Updating your profile…</div>
          </div>
        </div>
      </div>
    `

    bindChatEvents()
  }

  function appendMessage(role, text) {
    const messagesEl = document.getElementById('coach-messages')
    const emptyEl = document.getElementById('coach-empty')
    if (emptyEl) emptyEl.remove()

    const div = document.createElement('div')
    div.className = `coach-message ${role}`
    div.dataset.index = messages.length - 1

    const bubble = document.createElement('div')
    bubble.className = 'coach-bubble'
    bubble.textContent = text
    div.appendChild(bubble)
    messagesEl.appendChild(div)
    scrollToBottom()
  }

  function appendLoading() {
    const messagesEl = document.getElementById('coach-messages')
    const emptyEl = document.getElementById('coach-empty')
    if (emptyEl) emptyEl.remove()

    const div = document.createElement('div')
    div.className = 'coach-message assistant'
    div.id = 'coach-loading'

    const bubble = document.createElement('div')
    bubble.className = 'coach-bubble coach-bubble-loading'
    bubble.innerHTML = '<span></span><span></span><span></span>'
    div.appendChild(bubble)
    messagesEl.appendChild(div)
    scrollToBottom()
  }

  function removeLoading() {
    const el = document.getElementById('coach-loading')
    if (el) el.remove()
  }

  function scrollToBottom() {
    const el = document.getElementById('coach-messages')
    if (el) el.scrollTop = el.scrollHeight
  }

  function setInputState(disabled) {
    const input  = document.getElementById('coach-input')
    const send   = document.getElementById('coach-send')
    const end    = document.getElementById('coach-end')
    if (input) input.disabled = disabled
    if (send)  send.disabled  = disabled
    if (end)   end.disabled   = disabled
  }

  async function sendMessage() {
    const inputEl = document.getElementById('coach-input')
    const text = inputEl ? inputEl.value.trim() : ''
    if (!text || isWaiting) return

    messages.push({ role: 'user', content: text })
    appendMessage('user', text)
    inputEl.value = ''
    inputEl.style.height = 'auto'

    isWaiting = true
    setInputState(true)
    appendLoading()

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: COACH_SYSTEM_PROMPT + '\n\n## Your current profile\n\n' + JSON.stringify(getProfile(), null, 2),
          messages,
        }),
      })

      const data = await res.json()
      const reply = data?.content?.[0]?.text || 'No response received.'
      messages.push({ role: 'assistant', content: reply })
      removeLoading()
      appendMessage('assistant', reply)
    } catch (err) {
      console.error('Coach fetch error:', err)
      messages.push({ role: 'assistant', content: 'Something went wrong — check your Worker URL and try again.' })
      removeLoading()
      appendMessage('assistant', 'Something went wrong — check your Worker URL and try again.')
    }

    isWaiting = false
    setInputState(false)

    const inputEl2 = document.getElementById('coach-input')
    if (inputEl2) inputEl2.focus()
  }

  async function endSession() {
    if (messages.length === 0) return

    const updatingEl = document.getElementById('coach-updating')
    const updatingText = document.getElementById('coach-updating-text')
    if (updatingEl) updatingEl.classList.remove('hidden')

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: EXTRACTION_SYSTEM_PROMPT + '\n\n## Current profile\n\n' + JSON.stringify(getProfile(), null, 2),
          messages,
        }),
      })

      const data = await res.json()
      const raw = data?.content?.[0]?.text || '{}'

      let updates = {}
      try {
        // Strip markdown code fences if the model wrapped the JSON
        const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
        // Extract the first {...} block in case there's surrounding text
        const match = stripped.match(/\{[\s\S]*\}/)
        updates = match ? JSON.parse(match[0]) : {}
      } catch {
        console.warn('Could not parse extraction response:', raw)
      }

      await patchProfile(updates)

      if (updatingText) updatingText.textContent = 'Profile updated'
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (err) {
      console.error('Extraction error:', err)
      if (updatingText) updatingText.textContent = 'Could not update profile'
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    // Reset to fresh session
    messages = []
    if (updatingEl) updatingEl.classList.add('hidden')

    const messagesEl = document.getElementById('coach-messages')
    if (messagesEl) {
      messagesEl.innerHTML = `
        <div class="coach-empty" id="coach-empty">
          <p>Session ended. Your profile has been updated.</p>
        </div>
      `
    }

    isWaiting = false
    setInputState(false)
  }

  function bindChatEvents() {
    const view = document.getElementById('view-coach-chat')
    if (!view) return

    view.querySelector('#btn-back-coach').addEventListener('click', () => navigate('home'))
    view.querySelector('#btn-coach-profile').addEventListener('click', () => navigate('coach-profile'))
    view.querySelector('#coach-send').addEventListener('click', sendMessage)
    view.querySelector('#coach-end').addEventListener('click', endSession)

    const inputEl = view.querySelector('#coach-input')
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    })
    inputEl.addEventListener('input', () => autoResize(inputEl))
  }

  render()
}

// ─── Profile View ─────────────────────────────────────────────────────────

export function renderCoachProfile(container, { navigate }) {
  const openSections = new Set(PROFILE_DOMAINS.map(d => d.key))

  function render() {
    const profile = getProfile()

    const sectionsHtml = PROFILE_DOMAINS.map(domain => {
      const isOpen = openSections.has(domain.key)
      const fieldsHtml = domain.fields.map(field => {
        const value = profile[field]
        return `
          <div class="profile-field">
            <div class="profile-field-label">${formatFieldLabel(field)}</div>
            <div class="profile-field-value">${formatFieldValue(value)}</div>
          </div>
        `
      }).join('')

      return `
        <div class="profile-section" data-section="${domain.key}">
          <button class="profile-section-header" data-toggle="${domain.key}">
            <span class="profile-section-label">${domain.label}</span>
            <span class="profile-section-chevron">${isOpen ? ICONS.chevronDown : ICONS.chevronRight}</span>
          </button>
          <div class="profile-section-body${isOpen ? '' : ' hidden'}" data-body="${domain.key}">
            ${fieldsHtml}
          </div>
        </div>
      `
    }).join('')

    const updatedAt = profile.updated_at
      ? `Last updated ${formatDate(profile.updated_at)}`
      : 'Profile not yet populated — start a coaching session to build it.'

    container.innerHTML = `
      <div class="view" id="view-coach-profile">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-back" id="btn-back-profile">
              ${ICONS.back} Back
            </button>
          </div>
          <div class="header-title">Profile</div>
          <div class="header-right"></div>
        </header>

        <div class="scroll">
          <div class="profile-meta">${updatedAt}</div>
          <div class="profile-sections">
            ${sectionsHtml}
          </div>
        </div>
      </div>
    `

    bindProfileEvents()
  }

  function bindProfileEvents() {
    const view = document.getElementById('view-coach-profile')
    if (!view) return

    view.querySelector('#btn-back-profile').addEventListener('click', () => navigate('coach-chat'))

    view.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle
        if (openSections.has(key)) {
          openSections.delete(key)
        } else {
          openSections.add(key)
        }
        render()
      })
    })
  }

  render()
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function autoResize(ta) {
  ta.style.height = 'auto'
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
}

function formatFieldLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatFieldValue(value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="profile-field-empty">—</span>'
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="profile-field-empty">—</span>'
    return `<ul class="profile-field-list">${value.map(v => `<li>${escHtml(String(v))}</li>`).join('')}</ul>`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '<span class="profile-field-empty">—</span>'
    return `<dl class="profile-field-dict">${entries.map(([k, v]) =>
      `<dt>${escHtml(k)}</dt><dd>${escHtml(String(v))}</dd>`
    ).join('')}</dl>`
  }
  return `<span>${escHtml(String(value))}</span>`
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
