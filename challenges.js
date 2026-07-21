import { getCurrentTheme, toggleTheme } from './theme.js'

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
  const selected = normalized.length > 0 ? normalized : ['general fitness']
  const generated = []
  for (let i = 0; i < 3; i += 1) {
    const topic = selected[i % selected.length]
    generated.push({
      id: crypto.randomUUID(),
      text: buildChallengeForTopic(topic, difficulty, i),
      done: false,
    })
  }
  return generated
}

function buildChallengeForTopic(topic, difficulty, variant = 0) {
  const t = topic.toLowerCase()
  if (t.includes('flexibility') || t.includes('mobility') || t.includes('stretch')) {
    return pickByDifficulty(difficulty, variant, {
      starter: [
        'Flexibility: hold a standing toe-touch stretch for 20 seconds, rest, then repeat once.',
        'Flexibility: do a 60-second hamstring stretch on each leg.',
        'Flexibility: do 8 slow cat-cow reps and finish with a 30-second child’s pose.',
      ],
      core: [
        'Flexibility: complete a 5-minute mobility flow (hips, hamstrings, calves) without skipping any segment.',
        'Flexibility: hold deep squat stretch for 30 seconds, 3 rounds, keeping heels down.',
        'Flexibility: do couch stretch 45 seconds per side, then 10 controlled leg swings per leg.',
      ],
      stretch: [
        'Flexibility: complete a 10-minute full lower-body mobility routine and record your before/after toe-touch reach.',
        'Flexibility: hold front split progression (both sides) for 60 seconds each with controlled breathing.',
        'Flexibility: do a 12-minute yoga hip-opening sequence with zero phone distractions.',
      ],
    })
  }
  if (t.includes('social') || t.includes('friend') || t.includes('network')) {
    return pickByDifficulty(difficulty, variant, {
      starter: [
        'Social: ask one stranger for the time or directions and keep eye contact for one full sentence.',
        'Social: ask a barista or cashier one friendly question (e.g., “How is your day going?”).',
        'Social: send one short check-in message to a friend you have not spoken to in 2+ weeks.',
      ],
      core: [
        'Social: start a 3-minute conversation with someone new and ask one follow-up question.',
        'Social: introduce yourself to one person in your gym/workspace and learn their name.',
        'Social: invite one friend to a specific plan (time + place) today.',
      ],
      stretch: [
        'Social: have a 10-minute call with someone you usually only text and share one personal update.',
        'Social: attend one group event and speak to at least two new people.',
        'Social: ask one person for feedback on something you are working on and write down their response.',
      ],
    })
  }
  if (t.includes('writing') || t.includes('journal') || t.includes('content')) {
    return pickByDifficulty(difficulty, variant, {
      starter: [
        `Writing: write 3 unedited sentences about "${topic}" in one sitting.`,
        `Writing: create a title and bullet outline (5 bullets) for a piece on "${topic}".`,
        `Writing: write one 60-word caption/post draft about "${topic}".`,
      ],
      core: [
        `Writing: set a 10-minute timer and draft one focused paragraph on "${topic}".`,
        `Writing: draft 150 words on "${topic}" and revise once for clarity.`,
        `Writing: write one short how-to note on "${topic}" with 3 concrete steps.`,
      ],
      stretch: [
        `Writing: draft 300 words on "${topic}" and share it with one person for feedback.`,
        `Writing: publish one complete post/thread about "${topic}" today.`,
        `Writing: rewrite an old paragraph on "${topic}" to be 30% shorter and clearer.`,
      ],
    })
  }
  if (t.includes('health') || t.includes('fitness') || t.includes('exercise')) {
    return pickByDifficulty(difficulty, variant, {
      starter: [
        'Health: do 10 bodyweight squats and 10 wall push-ups right now.',
        'Health: take a 5-minute walk without your phone.',
        'Health: drink one full glass of water and do 2 minutes of deep breathing.',
      ],
      core: [
        'Health: complete a brisk 15-minute walk and finish with 2 minutes of stretching.',
        'Health: do 3 rounds of 12 squats, 8 push-ups, and a 30-second plank.',
        'Health: prepare one high-protein meal instead of ordering takeout.',
      ],
      stretch: [
        'Health: complete a 30-minute workout and log energy level before and after.',
        'Health: hit 8,000+ steps today and take one dedicated mobility break.',
        'Health: do a full push-pull-legs session or equivalent structured workout.',
      ],
    })
  }
  if (t.includes('coding') || t.includes('code') || t.includes('program')) {
    return pickByDifficulty(difficulty, variant, {
      starter: [
        `Coding: open "${topic}" and rename one unclear variable/function for clarity.`,
        `Coding: add one missing guard clause or null-check in "${topic}".`,
        `Coding: write one TODO list of exactly 3 concrete improvements for "${topic}".`,
      ],
      core: [
        `Coding: spend 20 minutes on "${topic}" and complete one commit-sized fix.`,
        `Coding: fix one focused bug in "${topic}" and add a quick test/check.`,
        `Coding: refactor one function in "${topic}" to reduce branching depth.`,
      ],
      stretch: [
        `Coding: implement one end-to-end improvement in "${topic}" and verify with manual test steps.`,
        `Coding: close one bug in "${topic}" and document root cause in 2 sentences.`,
        `Coding: ship one user-visible enhancement in "${topic}" before your next break.`,
      ],
    })
  }
  return pickByDifficulty(difficulty, variant, {
    starter: [
      `Starter: open your "${topic}" workspace and create a checklist with 3 specific actions.`,
      `Starter: spend 5 minutes doing the first concrete step in "${topic}" (no planning only).`,
      `Starter: remove one blocker for "${topic}" (close tabs, prep tools, set timer).`,
    ],
    core: [
      `Core: complete one clearly defined 15-minute task for "${topic}" and mark it done.`,
      `Core: produce one visible output for "${topic}" (draft, message, file, or checklist).`,
      `Core: do one task for "${topic}" that can be verified immediately.`,
    ],
    stretch: [
      `Stretch: complete a 30-minute deep-focus block on "${topic}" with phone away.`,
      `Stretch: deliver one meaningful result in "${topic}" and share it with someone.`,
      `Stretch: finish the hardest pending step in "${topic}" before stopping.`,
    ],
  })
}

function pickByDifficulty(difficulty, variant, options) {
  const tier = difficulty >= 2 ? 'stretch' : difficulty <= -2 ? 'starter' : 'core'
  const bucket = options[tier]
  return bucket[variant % bucket.length]
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
            <button class="btn btn-icon menu-grid-btn header-menu-btn" id="btn-challenges-home" aria-label="Menu">
              <span class="menu-grid-icon" aria-hidden="true"></span>
            </button>
          </div>
          <div class="header-title">Challenges</div>
          <div class="header-right">
            <button class="btn btn-secondary" id="btn-diff-down" type="button">-</button>
            <button class="btn btn-secondary" id="btn-diff-up" type="button">+</button>
            <button class="btn-icon theme-toggle" id="btn-theme-toggle" aria-label="Toggle theme"></button>
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

    // Theme toggle
    const themeBtn = container.querySelector('#btn-theme-toggle')
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
