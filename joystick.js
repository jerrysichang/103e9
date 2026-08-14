/**
 * Reusable Joystick Component
 * 
 * Usage:
 *   const joystick = createJoystick({
 *     directions: ['left', 'right', 'up', 'down'],
 *     labels: { left: 'Option 1', right: 'Option 2', up: 'Option 3' },
 *     onSelect: (direction) => console.log('Selected:', direction)
 *   })
 *   
 *   container.innerHTML = joystick.render()
 *   joystick.attach(container.querySelector('.joystick-container'))
 */

let joystickIdCounter = 0

export function createJoystick({
  directions = ['left', 'right', 'up', 'down'],
  labels = {},
  onSelect = null,
  scale = 1,
} = {}) {
  const id = `joystick-${joystickIdCounter++}`
  
  const defaultLabels = {
    left: 'Left',
    right: 'Right',
    up: 'Up',
    down: 'Down',
  }
  
  const mergedLabels = { ...defaultLabels, ...labels }
  
  function render() {
    return `
      <div class="joystick-container" id="${id}-container" style="${scale !== 1 ? `--joystick-scale: ${scale};` : ''}">
        <div class="joystick-stage">
          <div class="joystick-track"></div>
          ${directions.includes('left') ? `<div class="joystick-label joystick-label-left" data-direction="left">${mergedLabels.left}</div>` : ''}
          ${directions.includes('right') ? `<div class="joystick-label joystick-label-right" data-direction="right">${mergedLabels.right}</div>` : ''}
          ${directions.includes('up') ? `<div class="joystick-label joystick-label-up" data-direction="up">${mergedLabels.up}</div>` : ''}
          ${directions.includes('down') ? `<div class="joystick-label joystick-label-down" data-direction="down">${mergedLabels.down}</div>` : ''}
          <div class="joystick-stick" id="${id}-stick"></div>
        </div>
      </div>
    `
  }
  
  function attach(containerEl) {
    if (!containerEl) return () => {}
    
    const stick = containerEl.querySelector(`#${id}-stick`)
    const labelsNodeList = containerEl.querySelectorAll('.joystick-label')
    
    if (!stick) return () => {}
    
    const DEAD_ZONE = 8
    const MAX_DISTANCE = 22  // Tightened from 44
    const ACTIVATION_THRESHOLD = 16  // Adjusted proportionally
    const RESISTANCE_FACTOR = 0.2
    
    const directionAngles = {
      right: 0,
      up: 90,
      left: 180,
      down: 270,
    }
    
    let tracking = false
    let startX = 0
    let startY = 0
    let offsetX = 0
    let offsetY = 0
    let activeDirection = null
    
    const applyResistance = (value, max) => {
      const sign = value >= 0 ? 1 : -1
      const abs = Math.abs(value)
      if (abs <= max) return value
      const excess = abs - max
      return sign * (max + excess * RESISTANCE_FACTOR)
    }
    
    const getDirection = (dx, dy) => {
      const dist = Math.hypot(dx, dy)
      if (dist < DEAD_ZONE) return null
      
      let angle = Math.atan2(-dy, dx) * (180 / Math.PI)
      if (angle < 0) angle += 360
      
      let closestDir = null
      let minDiff = Infinity
      
      for (const dir of directions) {
        const dirAngle = directionAngles[dir]
        let diff = Math.abs(angle - dirAngle)
        if (diff > 180) diff = 360 - diff
        
        if (diff < minDiff && diff < 60) {
          minDiff = diff
          closestDir = dir
        }
      }
      
      return closestDir
    }
    
    const updateLabels = (showLabels, activeDir) => {
      labelsNodeList.forEach(label => {
        const dir = label.dataset.direction
        if (!directions.includes(dir)) {
          label.classList.add('joystick-label-disabled')
          return
        }
        
        if (showLabels) {
          label.classList.add('joystick-label-visible')
        } else {
          label.classList.remove('joystick-label-visible')
        }
        
        if (dir === activeDir) {
          label.classList.add('joystick-label-active')
        } else {
          label.classList.remove('joystick-label-active')
        }
      })
    }
    
    const setStickPosition = (x, y, animate = false) => {
      stick.classList.toggle('joystick-snapping', animate)
      stick.classList.toggle('joystick-dragging', !animate && tracking)
      stick.style.transform = `translate3d(${x}px, ${y}px, 0)`
      if (animate) {
        setTimeout(() => stick.classList.remove('joystick-snapping'), 350)
      }
    }
    
    const onPointerStart = e => {
      if (e.type === 'mousedown' && e.button !== 0) return
      tracking = true
      
      const touch = e.touches ? e.touches[0] : e
      startX = touch.clientX
      startY = touch.clientY
      offsetX = 0
      offsetY = 0
      activeDirection = null
      
      stick.classList.add('joystick-dragging')
      updateLabels(true, null)
    }
    
    const onPointerMove = e => {
      if (!tracking) return
      e.preventDefault()
      
      const touch = e.touches ? e.touches[0] : e
      let dx = touch.clientX - startX
      let dy = touch.clientY - startY
      
      dx = applyResistance(dx, MAX_DISTANCE)
      dy = applyResistance(dy, MAX_DISTANCE)
      
      offsetX = dx
      offsetY = dy
      
      const direction = getDirection(dx, dy)
      const dist = Math.hypot(dx, dy)
      
      if (direction && dist > ACTIVATION_THRESHOLD) {
        if (activeDirection !== direction) {
          activeDirection = direction
          updateLabels(true, activeDirection)
        }
        
        // Snap to the direction position
        const snapPositions = {
          right: [MAX_DISTANCE, 0],
          left: [-MAX_DISTANCE, 0],
          up: [0, -MAX_DISTANCE],
          down: [0, MAX_DISTANCE],
        }
        const [snapX, snapY] = snapPositions[direction] || [dx, dy]
        setStickPosition(snapX, snapY, false)
      } else {
        if (activeDirection !== null) {
          activeDirection = null
          updateLabels(true, null)
        }
        setStickPosition(dx, dy, false)
      }
    }
    
    const onPointerEnd = () => {
      if (!tracking) return
      tracking = false
      
      stick.classList.remove('joystick-dragging')
      
      if (activeDirection && onSelect) {
        setTimeout(() => onSelect(activeDirection), 50)
      }
      
      setStickPosition(0, 0, true)
      updateLabels(false, null)
      
      activeDirection = null
      offsetX = 0
      offsetY = 0
    }
    
    stick.addEventListener('mousedown', onPointerStart)
    stick.addEventListener('touchstart', onPointerStart, { passive: true })
    document.addEventListener('mousemove', onPointerMove)
    document.addEventListener('touchmove', onPointerMove, { passive: false })
    document.addEventListener('mouseup', onPointerEnd)
    document.addEventListener('touchend', onPointerEnd)
    
    return () => {
      stick.removeEventListener('mousedown', onPointerStart)
      stick.removeEventListener('touchstart', onPointerStart)
      document.removeEventListener('mousemove', onPointerMove)
      document.removeEventListener('touchmove', onPointerMove)
      document.removeEventListener('mouseup', onPointerEnd)
      document.removeEventListener('touchend', onPointerEnd)
      setStickPosition(0, 0, false)
      updateLabels(false, null)
    }
  }
  
  return {
    render,
    attach,
    id,
  }
}
