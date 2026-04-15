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
  const normalized = topics
    .map(t => String(t || '').trim())
    .filter(Boolean)
  const selected = normalized.slice(0, 3)
  while (selected.length < 3) selected.push(selected[0] || 'general growth')
  return selected.map(topic => ({
    id: crypto.randomUUID(),
    text: buildChallengeForTopic(topic, difficulty),
    done: false,
  }))
}

function buildChallengeForTopic(topic, difficulty) {
  const t = topic.toLowerCase()
  if (t.includes('social') || t.includes('friend') || t.includes('network')) {
    if (difficulty >= 2) return `Social: Start a 3-minute conversation with someone new and ask one follow-up question.`
    if (difficulty <= -2) return `Social: Ask someone for the time (or directions) and hold eye contact for one sentence.`
    return `Social: Ask someone a small question (time, recommendation, or opinion) and thank them by name.`
  }
  if (t.includes('writing') || t.includes('journal') || t.includes('content')) {
    if (difficulty >= 2) return `Writing: Draft 150 words on "${topic}" and share it with one person.`
    if (difficulty <= -2) return `Writing: Write 3 clear sentences about "${topic}" without editing.`
    return `Writing: Set a 10-minute timer and write one short paragraph on "${topic}".`
  }
  if (t.includes('health') || t.includes('fitness') || t.includes('exercise')) {
    if (difficulty >= 2) return `Health: Complete 20 minutes of movement and log exactly how you felt afterward.`
    if (difficulty <= -2) return `Health: Do 10 bodyweight squats or a 5-minute walk right now.`
    return `Health: Take a brisk 10-minute walk and avoid your phone the whole time.`
  }
  if (t.includes('coding') || t.includes('code') || t.includes('program')) {
    if (difficulty >= 2) return `Coding: Solve one focused bug in "${topic}" and write a one-line test/check for it.`
    if (difficulty <= -2) return `Coding: Open "${topic}" and improve one function name or comment for clarity.`
    return `Coding: Spend 15 minutes on "${topic}" and complete one tiny commit-sized improvement.`
  }
  if (difficulty >= 2) return `Stretch: Do one uncomfortable but specific action that advances "${topic}" in the next 20 minutes.`
  if (difficulty <= -2) return `Starter: Take a 2-minute first step on "${topic}" before leaving this screen.`
  return `Core: Complete one concrete action for "${topic}" that you can finish in under 10 minutes.`
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
        if (input.checked && next.topics.length > 0) {
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
