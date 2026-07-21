/**
 * Theme Management — Light / Dark Mode
 */

const STORAGE_KEY = 'theme'
const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
}

/**
 * Get the current theme from localStorage or system preference
 */
function getTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === THEMES.LIGHT || stored === THEMES.DARK) {
    return stored
  }
  // Default to light mode
  return THEMES.LIGHT
}

/**
 * Apply theme to the document
 */
function applyTheme(theme) {
  const root = document.documentElement
  const metaTheme = document.querySelector('meta[name="theme-color"]')
  
  if (theme === THEMES.DARK) {
    root.setAttribute('data-theme', 'dark')
    if (metaTheme) metaTheme.setAttribute('content', '#0a0a0a')
  } else {
    root.removeAttribute('data-theme')
    if (metaTheme) metaTheme.setAttribute('content', '#ffffff')
  }
}

/**
 * Toggle between light and dark theme
 */
export function toggleTheme() {
  const current = getTheme()
  const next = current === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT
  localStorage.setItem(STORAGE_KEY, next)
  applyTheme(next)
  return next
}

/**
 * Initialize theme on page load
 */
export function initTheme() {
  const theme = getTheme()
  applyTheme(theme)
}

/**
 * Get current theme
 */
export function getCurrentTheme() {
  return getTheme()
}

/**
 * Create a theme toggle button
 */
export function createThemeToggle() {
  const btn = document.createElement('button')
  btn.className = 'btn-icon theme-toggle'
  btn.setAttribute('aria-label', 'Toggle theme')
  btn.innerHTML = getCurrentTheme() === THEMES.DARK ? '☀' : '☾'
  
  btn.addEventListener('click', () => {
    toggleTheme()
    btn.innerHTML = getCurrentTheme() === THEMES.DARK ? '☀' : '☾'
  })
  
  return btn
}
