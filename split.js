import { getCurrentTheme, toggleTheme } from './theme.js'
import { bottomChrome, gridMenuFab, textFab } from './chrome.js'

const KEY = 'ps_split_v1'

const COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#ea580c', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#0d9488', '#c026d3'
]

const DEFAULT_STATE = {
  people: [],
  expenses: [],
  settlements: []
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULT_STATE)
    const parsed = JSON.parse(raw)
    return {
      people: Array.isArray(parsed?.people) ? parsed.people : [],
      expenses: Array.isArray(parsed?.expenses) ? parsed.expenses : [],
      settlements: Array.isArray(parsed?.settlements) ? parsed.settlements : []
    }
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// ─── Balance Calculations ─────────────────────────────────────────────────

function calculateBalances(state) {
  const balances = {}
  
  // Initialize balances for all people
  state.people.forEach(p => {
    balances[p.id] = 0
  })
  
  // Process expenses
  state.expenses.forEach(expense => {
    if (!expense.splitBetween || expense.splitBetween.length === 0) return
    
    const perPerson = expense.amount / expense.splitBetween.length
    
    // Person who paid gets positive balance
    balances[expense.paidBy] = (balances[expense.paidBy] || 0) + expense.amount
    
    // People who share the expense get negative balance
    expense.splitBetween.forEach(personId => {
      balances[personId] = (balances[personId] || 0) - perPerson
    })
  })
  
  // Process settlements
  state.settlements.forEach(settlement => {
    balances[settlement.from] = (balances[settlement.from] || 0) + settlement.amount
    balances[settlement.to] = (balances[settlement.to] || 0) - settlement.amount
  })
  
  return balances
}

function calculateDebts(state) {
  const balances = calculateBalances(state)
  const debts = []
  
  const creditors = []
  const debtors = []
  
  Object.entries(balances).forEach(([personId, balance]) => {
    if (balance > 0.01) {
      creditors.push({ id: personId, amount: balance })
    } else if (balance < -0.01) {
      debtors.push({ id: personId, amount: -balance })
    }
  })
  
  // Simplified debt calculation (greedy algorithm)
  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)
  
  let i = 0, j = 0
  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i]
    const debtor = debtors[j]
    const amount = Math.min(creditor.amount, debtor.amount)
    
    if (amount > 0.01) {
      debts.push({
        from: debtor.id,
        to: creditor.id,
        amount: amount
      })
    }
    
    creditor.amount -= amount
    debtor.amount -= amount
    
    if (creditor.amount < 0.01) i++
    if (debtor.amount < 0.01) j++
  }
  
  return debts
}

// ─── Rendering ────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function renderPersonBadge(person, size = 'sm') {
  const sizeClass = size === 'lg' ? 'split-person-lg' : ''
  return `
    <div class="split-person ${sizeClass}" style="background-color: ${person.color}20; border-color: ${person.color};">
      <span class="split-person-initial" style="color: ${person.color};">${escapeHtml(person.name.charAt(0).toUpperCase())}</span>
    </div>
  `
}

function renderBalanceSummary(state) {
  const balances = calculateBalances(state)
  const debts = calculateDebts(state)
  
  if (state.people.length === 0) {
    return `
      <div class="split-empty">
        <p>Add people to start tracking expenses</p>
      </div>
    `
  }
  
  const allSettled = debts.length === 0
  
  return `
    <div class="split-balances">
      <h3 class="section-label">Balances</h3>
      ${state.people.map(person => {
        const balance = balances[person.id] || 0
        const absBalance = Math.abs(balance)
        const status = balance > 0.01 ? 'owes-you' : balance < -0.01 ? 'you-owe' : 'settled'
        
        return `
          <div class="split-balance-row">
            ${renderPersonBadge(person)}
            <div class="split-balance-info">
              <div class="split-balance-name">${escapeHtml(person.name)}</div>
              ${absBalance > 0.01 ? `
                <div class="split-balance-amount split-balance-${status}">
                  ${status === 'owes-you' ? 'owes you' : 'you owe'} ${formatCurrency(absBalance)}
                </div>
              ` : `
                <div class="split-balance-settled">settled up</div>
              `}
            </div>
          </div>
        `
      }).join('')}
    </div>
    
    ${debts.length > 0 ? `
      <div class="split-settlements">
        <h3 class="section-label">Suggested Settlements</h3>
        ${debts.map(debt => {
          const fromPerson = state.people.find(p => p.id === debt.from)
          const toPerson = state.people.find(p => p.id === debt.to)
          if (!fromPerson || !toPerson) return ''
          
          return `
            <div class="split-settlement-row">
              <div class="split-settlement-people">
                ${renderPersonBadge(fromPerson)}
                <span class="split-settlement-arrow">→</span>
                ${renderPersonBadge(toPerson)}
              </div>
              <div class="split-settlement-amount">${formatCurrency(debt.amount)}</div>
              <button class="btn btn-secondary split-settle-btn" data-settle-from="${debt.from}" data-settle-to="${debt.to}" data-settle-amount="${debt.amount}">
                Settle
              </button>
            </div>
          `
        }).join('')}
      </div>
    ` : ''}
  `
}

function renderExpensesList(state) {
  if (state.expenses.length === 0) {
    return `
      <div class="split-empty">
        <p>No expenses yet</p>
      </div>
    `
  }
  
  const sorted = [...state.expenses].sort((a, b) => new Date(b.date) - new Date(a.date))
  
  return `
    <div class="split-expenses">
      <h3 class="section-label">Expenses</h3>
      <ul class="split-expense-list">
        ${sorted.map(expense => {
          const paidBy = state.people.find(p => p.id === expense.paidBy)
          if (!paidBy) return ''
          
          return `
            <li class="split-expense-item" data-expense-id="${expense.id}">
              <div class="split-expense-main">
                <div class="split-expense-desc">${escapeHtml(expense.description)}</div>
                <div class="split-expense-meta">
                  ${renderPersonBadge(paidBy)} paid ${formatCurrency(expense.amount)} · ${formatDate(expense.date)}
                </div>
                <div class="split-expense-split">
                  Split between ${expense.splitBetween.length} ${expense.splitBetween.length === 1 ? 'person' : 'people'}
                </div>
              </div>
              <button class="btn btn-icon split-delete-expense" data-delete-expense="${expense.id}" aria-label="Delete">×</button>
            </li>
          `
        }).join('')}
      </ul>
    </div>
  `
}

export function renderSplit(container, { navigate }) {
  const state = loadState()
  
  container.innerHTML = `
    <div class="view" id="view-split">
      <header class="header">
        <div class="header-left">
          ${gridMenuFab({ id: 'btn-split-home' })}
        </div>
        <h1 class="header-title">Split</h1>
        <div class="header-right">
          <button class="btn btn-icon" id="btn-split-people" aria-label="Manage people">👥</button>
          <button class="btn-icon theme-toggle" id="btn-theme-toggle" aria-label="Toggle theme"></button>
        </div>
      </header>
      
      <div class="scroll split-scroll">
        ${renderBalanceSummary(state)}
        ${renderExpensesList(state)}
      </div>
      
      ${bottomChrome([
        textFab({
          id: 'btn-split-add-expense',
          icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
          label: 'Add Expense'
        })
      ])}
    </div>
    
    <!-- Add Expense Modal -->
    <div class="modal-backdrop hidden" id="split-expense-modal">
      <div class="modal">
        <div class="modal-handle"></div>
        <h2 class="modal-title">Add Expense</h2>
        
        <label class="split-field-label">Description</label>
        <input type="text" class="input" id="expense-description" placeholder="Dinner, groceries, etc." />
        
        <label class="split-field-label">Amount</label>
        <input type="number" class="input" id="expense-amount" placeholder="0.00" step="0.01" min="0" />
        
        <label class="split-field-label">Who paid?</label>
        <div class="split-person-select" id="expense-paid-by">
          ${state.people.map(person => `
            <button type="button" class="split-person-option" data-person-id="${person.id}">
              ${renderPersonBadge(person)}
              <span>${escapeHtml(person.name)}</span>
            </button>
          `).join('')}
        </div>
        
        <label class="split-field-label">Split between</label>
        <div class="split-person-select" id="expense-split-between">
          ${state.people.map(person => `
            <button type="button" class="split-person-option split-person-toggle" data-person-id="${person.id}">
              ${renderPersonBadge(person)}
              <span>${escapeHtml(person.name)}</span>
              <span class="split-check">✓</span>
            </button>
          `).join('')}
        </div>
        
        <div class="modal-actions">
          <button class="btn btn-secondary" id="expense-cancel">Cancel</button>
          <button class="btn btn-primary" id="expense-save">Add</button>
        </div>
      </div>
    </div>
    
    <!-- Manage People Modal -->
    <div class="modal-backdrop hidden" id="split-people-modal">
      <div class="modal">
        <div class="modal-handle"></div>
        <h2 class="modal-title">Manage People</h2>
        
        <div class="split-people-list">
          ${state.people.map(person => `
            <div class="split-people-item">
              ${renderPersonBadge(person, 'lg')}
              <span class="split-people-name">${escapeHtml(person.name)}</span>
              <button class="btn btn-danger split-delete-person" data-delete-person="${person.id}">Remove</button>
            </div>
          `).join('')}
        </div>
        
        <div class="split-add-person">
          <input type="text" class="input" id="new-person-name" placeholder="Name" />
          <button class="btn btn-primary" id="add-person-btn">Add Person</button>
        </div>
        
        <div class="modal-actions">
          <button class="btn btn-secondary" id="people-done">Done</button>
        </div>
      </div>
    </div>
  `
  
  bind()
  
  function bind() {
    // Navigation
    container.querySelector('#btn-split-home')?.addEventListener('click', () => navigate('home'))
    
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
    
    // Add expense modal
    const expenseModal = container.querySelector('#split-expense-modal')
    const addExpenseBtn = container.querySelector('#btn-split-add-expense')
    
    addExpenseBtn?.addEventListener('click', () => {
      if (state.people.length === 0) {
        alert('Add people first')
        return
      }
      expenseModal?.classList.remove('hidden')
      // Select all people by default
      container.querySelectorAll('#expense-split-between .split-person-toggle').forEach(btn => {
        btn.classList.add('is-selected')
      })
    })
    
    container.querySelector('#expense-cancel')?.addEventListener('click', () => {
      expenseModal?.classList.add('hidden')
    })
    
    expenseModal?.addEventListener('click', e => {
      if (e.target === expenseModal) expenseModal.classList.add('hidden')
    })
    
    // Person selection (paid by)
    let selectedPayer = null
    container.querySelectorAll('#expense-paid-by .split-person-option').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('#expense-paid-by .split-person-option').forEach(b => 
          b.classList.remove('is-selected'))
        btn.classList.add('is-selected')
        selectedPayer = btn.dataset.personId
      })
    })
    
    // Person selection (split between - multiple)
    container.querySelectorAll('#expense-split-between .split-person-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('is-selected')
      })
    })
    
    // Save expense
    container.querySelector('#expense-save')?.addEventListener('click', () => {
      const description = container.querySelector('#expense-description').value.trim()
      const amount = parseFloat(container.querySelector('#expense-amount').value)
      
      const splitBetween = Array.from(
        container.querySelectorAll('#expense-split-between .split-person-toggle.is-selected')
      ).map(btn => btn.dataset.personId)
      
      if (!description) {
        alert('Please enter a description')
        return
      }
      
      if (!amount || amount <= 0) {
        alert('Please enter a valid amount')
        return
      }
      
      if (!selectedPayer) {
        alert('Please select who paid')
        return
      }
      
      if (splitBetween.length === 0) {
        alert('Please select at least one person to split between')
        return
      }
      
      state.expenses.push({
        id: generateId(),
        description,
        amount,
        paidBy: selectedPayer,
        splitBetween,
        date: new Date().toISOString()
      })
      
      saveState(state)
      expenseModal?.classList.add('hidden')
      renderSplit(container, { navigate })
    })
    
    // Delete expense
    container.querySelectorAll('.split-delete-expense').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!confirm('Delete this expense?')) return
        const id = btn.dataset.deleteExpense
        state.expenses = state.expenses.filter(exp => exp.id !== id)
        saveState(state)
        renderSplit(container, { navigate })
      })
    })
    
    // Manage people modal
    const peopleModal = container.querySelector('#split-people-modal')
    container.querySelector('#btn-split-people')?.addEventListener('click', () => {
      peopleModal?.classList.remove('hidden')
    })
    
    container.querySelector('#people-done')?.addEventListener('click', () => {
      peopleModal?.classList.add('hidden')
      renderSplit(container, { navigate })
    })
    
    peopleModal?.addEventListener('click', e => {
      if (e.target === peopleModal) {
        peopleModal.classList.add('hidden')
        renderSplit(container, { navigate })
      }
    })
    
    // Add person
    const addPersonInput = container.querySelector('#new-person-name')
    const addPersonBtn = container.querySelector('#add-person-btn')
    
    const addPerson = () => {
      const name = addPersonInput.value.trim()
      if (!name) return
      
      const usedColors = state.people.map(p => p.color)
      const availableColors = COLORS.filter(c => !usedColors.includes(c))
      const color = availableColors[0] || COLORS[state.people.length % COLORS.length]
      
      state.people.push({
        id: generateId(),
        name,
        color
      })
      
      saveState(state)
      addPersonInput.value = ''
      renderSplit(container, { navigate })
    }
    
    addPersonBtn?.addEventListener('click', addPerson)
    addPersonInput?.addEventListener('keypress', e => {
      if (e.key === 'Enter') addPerson()
    })
    
    // Delete person
    container.querySelectorAll('.split-delete-person').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.deletePerson
        
        // Check if person has any expenses
        const hasExpenses = state.expenses.some(exp => 
          exp.paidBy === id || exp.splitBetween.includes(id)
        )
        
        if (hasExpenses && !confirm('This person has expenses. Deleting will remove them from all expenses. Continue?')) {
          return
        }
        
        state.people = state.people.filter(p => p.id !== id)
        // Remove from expenses
        state.expenses = state.expenses.filter(exp => exp.paidBy !== id)
        state.expenses.forEach(exp => {
          exp.splitBetween = exp.splitBetween.filter(pid => pid !== id)
        })
        state.expenses = state.expenses.filter(exp => exp.splitBetween.length > 0)
        
        saveState(state)
        renderSplit(container, { navigate })
      })
    })
    
    // Settle up
    container.querySelectorAll('.split-settle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const from = btn.dataset.settleFrom
        const to = btn.dataset.settleTo
        const amount = parseFloat(btn.dataset.settleAmount)
        
        const fromPerson = state.people.find(p => p.id === from)
        const toPerson = state.people.find(p => p.id === to)
        
        if (!confirm(`Mark ${formatCurrency(amount)} from ${fromPerson?.name} to ${toPerson?.name} as settled?`)) {
          return
        }
        
        state.settlements.push({
          id: generateId(),
          from,
          to,
          amount,
          date: new Date().toISOString()
        })
        
        saveState(state)
        renderSplit(container, { navigate })
      })
    })
  }
}
