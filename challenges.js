const KEY = 'ps_challenges_v1'

const DEFAULT_STATE = {
  difficulty: 0,
  topics: [],
  challenges: [],
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw)
    return {
      difficulty: Number(parsed?.difficulty) || 0,
      topics: Array.isArray(parsed?.topics) ? parsed.topics : [],
      challenges: Array.isArray(parsed?.challenges) ? parsed.challenges : [],
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

function makeThree(topics, difficulty) {
  const topic = topics[0] || 'General'
  const levelWord = difficulty > 0 ? 'harder' : difficulty < 0 ? 'easier' : 'balanced'
  const prefix = difficulty > 0 ? 'Stretch' : difficulty < 0 ? 'Starter' : 'Core'
  return [
    `${prefix}: Spend 10 minutes on "${topic}" focused work (${levelWord}).`,
    `${prefix}: Write one concrete next action for "${topic}" and do it now.`,
    `${prefix}: Remove one distraction that blocks progress on "${topic}".`,
  ].map(text => ({ id: crypto.randomUUID(), text, done: false }))
}

export function renderChallenges(container, { navigate }) {
  let state = loadState()

  function rerender() {
    state = loadState()
    const topics = state.topics
    const challenges = state.challenges
    container.innerHTML = `
      <div class="view" id="view-challenges">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-icon menu-grid-btn" id="btn-challenges-home" aria-label="Menu"><span class="menu-grid-icon" aria-hidden="true"></span></button>
            <div class="header-title">Challenges</div>
          </div>
          <div class="header-right">
            <button class="btn btn-secondary" id="btn-diff-down" type="button">-</button>
            <button class="btn btn-secondary" id="btn-diff-up" type="button">+</button>
          </div>
        </header>
        <div class="scroll">
          <div class="issues-add-wrap">
            <input class="input" id="challenge-topic-input" type="text" maxlength="120" placeholder="Add topic (e.g. writing, coding, health)" />
            <button class="btn btn-primary issues-add-btn" id="btn-add-topic">Add topic</button>
            <p class="diet-modal-hint">Difficulty: ${state.difficulty > 0 ? `+${state.difficulty}` : state.difficulty}</p>
          </div>

          <div class="section-header">
            <span class="section-label">Topics</span>
            <span class="section-count">${topics.length}</span>
          </div>
          <ul class="item-list">
            ${topics.length === 0 ? `<li style="list-style:none"><div class="empty-state"><p>Add one topic to start generating challenges.</p></div></li>` : topics.map((t, i) => `
              <li class="item">
                <div class="item-body"><span class="item-title issue-title">${escapeHtml(t)}</span></div>
                <button class="btn issue-delete-btn" data-topic-del="${i}" aria-label="Delete topic">×</button>
              </li>
            `).join('')}
          </ul>

          <div class="issues-add-wrap" style="padding-top:12px">
            <button class="btn btn-primary issues-add-btn" id="btn-generate">Generate 3 Challenges</button>
          </div>

          <div class="section-header">
            <span class="section-label">Current</span>
            <span class="section-count">${challenges.filter(c => !c.done).length}</span>
          </div>
          <ul class="item-list">
            ${challenges.length === 0 ? `<li style="list-style:none"><div class="empty-state"><p>No challenges yet.</p></div></li>` : challenges.map(c => `
              <li class="item ${c.done ? 'issue-completed' : ''}">
                <div class="item-body">
                  <label class="issue-check-wrap">
                    <input class="issue-check" type="checkbox" data-challenge-toggle="${c.id}" ${c.done ? 'checked' : ''}>
                    <span class="issue-check-ui">${c.done ? '✓' : ''}</span>
                  </label>
                  <span class="item-title issue-title">${escapeHtml(c.text)}</span>
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    `

    bind()
  }

  function bind() {
    container.querySelector('#btn-challenges-home')?.addEventListener('click', () => navigate('home'))
    container.querySelector('#btn-add-topic')?.addEventListener('click', () => {
      const input = container.querySelector('#challenge-topic-input')
      const text = String(input?.value || '').trim()
      if (!text) return
      const next = loadState()
      next.topics.push(text)
      saveState(next)
      rerender()
    })
    container.querySelector('#btn-diff-down')?.addEventListener('click', () => {
      const next = loadState()
      next.difficulty = Math.max(-3, (next.difficulty || 0) - 1)
      saveState(next)
      rerender()
    })
    container.querySelector('#btn-diff-up')?.addEventListener('click', () => {
      const next = loadState()
      next.difficulty = Math.min(3, (next.difficulty || 0) + 1)
      saveState(next)
      rerender()
    })
    container.querySelector('#btn-generate')?.addEventListener('click', () => {
      const next = loadState()
      if (next.topics.length === 0) return
      next.challenges = makeThree(next.topics, next.difficulty)
      saveState(next)
      rerender()
    })

    container.querySelectorAll('[data-topic-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.topicDel)
        const next = loadState()
        next.topics = next.topics.filter((_, i) => i !== idx)
        saveState(next)
        rerender()
      })
    })

    container.querySelectorAll('[data-challenge-toggle]').forEach(input => {
      input.addEventListener('change', () => {
        const next = loadState()
        const idx = next.challenges.findIndex(c => c.id === input.dataset.challengeToggle)
        if (idx === -1) return
        next.challenges[idx].done = input.checked
        const doneCount = next.challenges.filter(c => c.done).length
        if (doneCount >= next.challenges.length && next.challenges.length > 0) {
          next.challenges = makeThree(next.topics, next.difficulty)
        }
        saveState(next)
        rerender()
      })
    })
  }

  rerender()
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
