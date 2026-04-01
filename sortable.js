/**
 * Touch + mouse drag-and-drop for list reordering.
 * Works on iPhone and desktop via Pointer Events.
 *
 * Usage:
 *   const sort = makeSortable(listEl, (orderedIds) => { ... })
 *   sort.destroy() // when done
 */
export function makeSortable(listEl, onSort) {
  let state = null

  function getItems() {
    return [...listEl.querySelectorAll('[data-sort-id]')]
  }

  function onPointerDown(e) {
    const handle = e.target.closest('[data-sort-handle]')
    if (!handle) return

    const item = e.target.closest('[data-sort-id]')
    if (!item) return

    e.preventDefault()

    const rect = item.getBoundingClientRect()

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
    item.style.visibility = 'hidden'

    state = {
      item,
      ghost,
      placeholder,
      startY:   e.clientY,
      ghostTop: rect.top,
    }

    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup',   onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
  }

  function onPointerMove(e) {
    if (!state) return
    e.preventDefault()

    const dy  = e.clientY - state.startY
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

    const { item, ghost, placeholder } = state
    state = null

    // Drop item where placeholder is
    placeholder.before(item)
    item.style.visibility = ''
    placeholder.remove()
    ghost.remove()

    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup',   onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)

    const orderedIds = getItems().map(el => el.dataset.sortId)
    onSort(orderedIds)
  }

  listEl.addEventListener('pointerdown', onPointerDown)

  return {
    destroy() {
      listEl.removeEventListener('pointerdown', onPointerDown)
    },
  }
}
