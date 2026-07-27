/**
 * Shared bottom navigation chrome helpers.
 *
 * Top-level: left = grid → home, right = page actions / segments
 * Sub-page:  left = back to tool top-level, right = cancel / primary CTA
 */

export const MENU_GRID_ICON = `<span class="menu-grid-icon" aria-hidden="true"></span>`

export function bottomChrome({ left = '', right = '', label = 'Page navigation' } = {}) {
  return `
    <nav class="bottom-chrome" aria-label="${label}">
      <div class="bottom-chrome-left">${left}</div>
      <div class="bottom-chrome-right">${right}</div>
    </nav>
  `
}

export function gridMenuFab(id = 'btn-menu-home') {
  return `
    <button type="button" class="btn btn-icon menu-grid-btn" id="${id}" aria-label="Home">
      ${MENU_GRID_ICON}
    </button>
  `
}

export function textFab({ id, label, className = '', type = 'button', attrs = '' }) {
  const extra = className ? ` ${className}` : ''
  return `
    <button type="${type}" class="btn fab-text${extra}" id="${id}" ${attrs}>${label}</button>
  `
}

/** Segmented control styled as a single right-side FAB group */
export function fabSegment({ name, options, active, attr = 'data-segment' }) {
  return `
    <div class="fab-segment" role="tablist" aria-label="${name}">
      ${options.map(opt => `
        <button
          type="button"
          role="tab"
          class="fab-segment-btn${opt.value === active ? ' is-active' : ''}"
          ${attr}="${opt.value}"
          aria-selected="${opt.value === active ? 'true' : 'false'}"
        >${opt.label}</button>
      `).join('')}
    </div>
  `
}
