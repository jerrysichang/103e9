/**
 * Touch + mouse drag-and-drop for list reordering.
 * Works on iPhone and desktop via Pointer Events.
 * Requires a minimum drag distance before activating to avoid jank on taps.
 *
 * Usage:
 *   const sort = makeSortable(listEl, (orderedIds) => { ... })
 *   sort.destroy() // when done
 */
export function makeSortable(listEl, onSort, options = {}) {
  let state = null
  let lastDragAt = 0
  const DRAG_THRESHOLD = 5 // px before drag activates
  const handleSelector = Object.prototype.hasOwnProperty.call(options, 'handleSelector')
    ? options.handleSelector
    : '[data-sort-handle]'

  function getItems() {
    return [...listEl.querySelectorAll('[data-sort-id]')]
  }

  function onPointerDown(e) {
    const item = e.target.closest('[data-sort-id]')
    if (!item) return

    const handle = handleSelector ? e.target.closest(handleSelector) : item
    if (handleSelector && !handle) return

    e.preventDefault()
    if (handle && typeof handle.setPointerCapture === 'function') {
      handle.setPointerCapture(e.pointerId)
    }

    const rect = item.getBoundingClientRect()

    state = {
      item,
      ghost: null,
      placeholder: null,
      startY:   e.clientY,
      ghostTop: rect.top,
      rect,
      dragging: false,
      pointerId: e.pointerId,
      captureEl: handle || item,
    }

    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup',   onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
  }

  function activateDrag() {
    if (!state || state.dragging) return
    state.dragging = true

    const { item, rect } = state

    // Ghost (visual drag proxy)
    const ghost = item.cloneNode(true)
    ghost.classList.add('sort-ghost')
    ghost.style.width  = rect.width  + 'px'
    ghost.style.height = rect.height + 'px'
    ghost.style.top    = rect.top    + 'px'
    ghost.style.left   = rect.left   + 'px'
    document.body.appendChild(ghost)

    // Placeholder (keeps space in list)
    const placeholder = document.createElement('li')
    placeholder.className    = 'sort-placeholder'
    placeholder.style.height = rect.height + 'px'
    item.after(placeholder)
    item.style.display = 'none'

    state.ghost = ghost
    state.placeholder = placeholder
  }

  function onPointerMove(e) {
    if (!state) return
    e.preventDefault()

    const dy = e.clientY - state.startY

    // Don't start dragging until threshold is met
    if (!state.dragging) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return
      activateDrag()
    }

    const top = state.ghostTop + dy
    state.ghost.style.top = top + 'px'

    // Determine where placeholder should be
    const midY    = top + state.ghost.offsetHeight / 2
    const siblings = getItems().filter(el => el !== state.item)

    let placed = false
    for (const sib of siblings) {
      const sibRect = sib.getBoundingClientRect()
      if (midY < sibRect.top + sibRect.height / 2) {
        sib.before(state.placeholder)
        placed = true
        break
      }
    }
    if (!placed && siblings.length > 0) {
      siblings[siblings.length - 1].after(state.placeholder)
    }
  }

  function onPointerUp() {
    if (!state) return

    const { item, ghost, placeholder, dragging, pointerId, captureEl } = state
    state = null

    if (captureEl && typeof captureEl.releasePointerCapture === 'function') {
      try { captureEl.releasePointerCapture(pointerId) } catch {}
    }

    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup',   onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)

    if (!dragging) return // was just a tap, not a drag

    // Drop item where placeholder is
    placeholder.before(item)
    item.style.display = ''
    placeholder.remove()
    ghost.remove()
    lastDragAt = Date.now()

    const orderedIds = getItems().map(el => el.dataset.sortId)
    onSort(orderedIds)
  }

  function onClickCapture(e) {
    if (Date.now() - lastDragAt < 250) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  listEl.addEventListener('pointerdown', onPointerDown)
  listEl.addEventListener('click', onClickCapture, true)

  return {
    destroy() {
      listEl.removeEventListener('pointerdown', onPointerDown)
      listEl.removeEventListener('click', onClickCapture, true)
    },
  }
}
