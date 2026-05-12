/**
 * Touch + mouse drag-and-drop for list reordering.
 * Works on iPhone and desktop via Pointer Events.
 *
 * Behavior:
 *  - With `holdDelayMs: 0` (default), drag activates immediately on pointer move
 *    past a small threshold. Best for desktops and explicit drag handles.
 *  - With `holdDelayMs > 0`, the user must press-and-hold a touch item for that
 *    many milliseconds before drag is "armed". During the hold, normal page
 *    scrolling is allowed; once armed, the item visually lifts and subsequent
 *    movement reorders the list. Moving the finger past `CANCEL_THRESHOLD`
 *    before arming cancels the gesture, letting the page scroll instead.
 *
 * Usage:
 *   const sort = makeSortable(listEl, (orderedIds) => { ... }, options)
 *   sort.destroy()
 */
export function makeSortable(listEl, onSort, options = {}) {
  const DRAG_THRESHOLD = 5      // px before drag activates after armed
  const CANCEL_THRESHOLD = 14   // px finger jitter tolerated during hold
  const CLICK_SUPPRESS_MS = 250
  const HOLD_MS = Math.max(0, Number(options.holdDelayMs) || 0)
  const handleSelector = Object.prototype.hasOwnProperty.call(options, 'handleSelector')
    ? options.handleSelector
    : '[data-sort-handle]'

  /** @type {null | ReturnType<typeof createState>} */
  let state = null
  let lastDragAt = 0

  function createState(item, handle, rect, e, requiresHold) {
    return {
      item,
      handle,
      rect,
      startX: e.clientX,
      startY: e.clientY,
      ghostTop: rect.top,
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'mouse',
      captureEl: handle || item,
      armed: !requiresHold,
      dragging: false,
      ghost: null,
      placeholder: null,
      holdTimer: null,
      prevTouchAction: undefined,
    }
  }

  function getItems() {
    return [...listEl.querySelectorAll('[data-sort-id]')]
  }

  function onPointerDown(e) {
    if (state) return // ignore secondary pointers

    const item = e.target.closest('[data-sort-id]')
    if (!item) return
    const handle = handleSelector ? e.target.closest(handleSelector) : item
    if (handleSelector && !handle) return

    const isTouch = e.pointerType === 'touch'
    const requiresHold = isTouch && HOLD_MS > 0

    const rect = item.getBoundingClientRect()
    state = createState(item, handle, rect, e, requiresHold)

    if (!requiresHold) {
      // Mouse / immediate-drag path: take ownership of the gesture now.
      e.preventDefault()
      try { state.captureEl.setPointerCapture?.(e.pointerId) } catch {}
    } else {
      // Touch + hold path: defer ownership until hold completes so the user
      // can still scroll the page.
      state.holdTimer = window.setTimeout(armDrag, HOLD_MS)
    }

    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
    // iOS Safari: pointermove preventDefault does not stop scrolling. Listen to
    // the underlying touchmove with passive:false so we can actually cancel
    // scroll once the user has armed the drag.
    if (isTouch) {
      document.addEventListener('touchmove', onTouchMove, { passive: false })
    }
  }

  function onTouchMove(e) {
    if (state && state.armed && e.cancelable) e.preventDefault()
  }

  function armDrag() {
    if (!state || state.armed) return
    state.armed = true
    state.holdTimer = null
    state.item.classList.add('sort-armed')
    // Belt-and-suspenders: tell the browser this element should not scroll.
    state.prevTouchAction = state.item.style.touchAction
    state.item.style.touchAction = 'none'
    try { state.captureEl?.setPointerCapture?.(state.pointerId) } catch {}
    try { navigator.vibrate?.(10) } catch {}
  }

  function activateDrag() {
    if (!state || state.dragging) return
    state.dragging = true

    const { item, rect } = state

    const ghost = item.cloneNode(true)
    ghost.classList.add('sort-ghost')
    ghost.classList.remove('sort-armed')
    ghost.style.width  = rect.width  + 'px'
    ghost.style.height = rect.height + 'px'
    ghost.style.top    = rect.top    + 'px'
    ghost.style.left   = rect.left   + 'px'
    document.body.appendChild(ghost)

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

    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY

    if (!state.armed) {
      // Pre-hold: tolerate small jitter, otherwise treat as scroll and cancel.
      if (Math.hypot(dx, dy) >= CANCEL_THRESHOLD) cancelGesture()
      return
    }

    // Armed: take over the gesture so the browser stops considering scroll.
    e.preventDefault()

    if (!state.dragging) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return
      activateDrag()
    }

    const top = state.ghostTop + dy
    state.ghost.style.top = top + 'px'

    const midY = top + state.ghost.offsetHeight / 2
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

    const { item, ghost, placeholder, dragging, armed, pointerId, captureEl, prevTouchAction } = state
    if (state.holdTimer) window.clearTimeout(state.holdTimer)
    item?.classList.remove('sort-armed')
    if (item && prevTouchAction !== undefined) item.style.touchAction = prevTouchAction
    state = null

    if (captureEl && typeof captureEl.releasePointerCapture === 'function') {
      try { captureEl.releasePointerCapture(pointerId) } catch {}
    }

    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
    document.removeEventListener('touchmove', onTouchMove)

    if (!dragging) {
      // Armed but never dragged → suppress the synthetic click so it doesn't
      // navigate when the user lifts after a hold.
      if (armed) lastDragAt = Date.now()
      return
    }

    placeholder.before(item)
    item.style.display = ''
    placeholder.remove()
    ghost.remove()
    lastDragAt = Date.now()

    const orderedIds = getItems().map(el => el.dataset.sortId)
    onSort(orderedIds)
  }

  function cancelGesture() {
    if (!state) return
    const { item, holdTimer, pointerId, captureEl, prevTouchAction } = state
    if (holdTimer) window.clearTimeout(holdTimer)
    item?.classList.remove('sort-armed')
    if (item && prevTouchAction !== undefined) item.style.touchAction = prevTouchAction
    state = null
    if (captureEl && typeof captureEl.releasePointerCapture === 'function') {
      try { captureEl.releasePointerCapture(pointerId) } catch {}
    }
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
    document.removeEventListener('touchmove', onTouchMove)
  }

  function onClickCapture(e) {
    if (Date.now() - lastDragAt < CLICK_SUPPRESS_MS) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  listEl.addEventListener('pointerdown', onPointerDown)
  listEl.addEventListener('click', onClickCapture, true)

  return {
    destroy() {
      cancelGesture()
      listEl.removeEventListener('pointerdown', onPointerDown)
      listEl.removeEventListener('click', onClickCapture, true)
    },
  }
}
