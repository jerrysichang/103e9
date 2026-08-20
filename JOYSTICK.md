# Reusable Joystick Component

A drag-and-release UI component with directional labels and overlay support.

## Usage

```javascript
import { createJoystick } from './joystick.js'

// Create a joystick instance
const joystick = createJoystick({
  directions: ['left', 'right', 'up', 'down'],  // Optional: default is all 4
  labels: {
    left: 'Previous',
    right: 'Next',
    up: 'Confirm',
    down: 'Cancel'
  },
  value: 'up',   // Optional: direction to mark as currently selected
  onSelect: (direction) => {
    console.log('Selected direction:', direction)
    // Handle the direction selection
  },
  scale: 1  // Optional: scale the joystick size (default: 1)
})

// Render the joystick HTML
container.innerHTML = joystick.render()

// Attach event handlers
const cleanup = joystick.attach(container.querySelector('.joystick-container'))

// Reflect a selection change without re-rendering
joystick.setValue('left')

// Later, cleanup when done
cleanup()
```

## Features

- **Directional labels**: Configurable labels that appear and highlight based on drag direction
- **Persistent selection**: The selected direction's label stays legible at rest, so the current value is always visible
- **Snapping**: Once past the activation threshold the stick snaps to the direction, so selection is unambiguous
- **Resistance physics**: Natural feel with resistance beyond max distance
- **Dead zone**: Ignores tiny movements for better UX
- **Touch & mouse support**: Works with both touch and mouse events
- **Auto-cleanup**: Returns a cleanup function to remove all event listeners
- **Unique IDs**: Each instance gets unique element IDs to avoid conflicts

## Configuration

### `directions`
Array of enabled directions. Options: `'left'`, `'right'`, `'up'`, `'down'`

Default: `['left', 'right', 'up', 'down']`

### `labels`
Object mapping directions to label text.

Default:
```javascript
{
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down'
}
```

### `onSelect`
Callback function called when user releases after dragging past the activation threshold.

Receives: `direction` (string: 'left', 'right', 'up', or 'down')

### `value`
Direction to mark as the current selection. Its label stays visible while the
joystick is at rest so the active value is always readable.

Default: `null`

### `scale`
Optional scale multiplier for the joystick size.

Default: `1`

## Methods

### `render()`
Returns the component's HTML string.

### `attach(containerEl)`
Binds pointer handlers to the rendered `.joystick-container`. Returns a cleanup
function that removes every listener.

### `setValue(direction)`
Updates the current selection in place. Use this when the owning view changes
state without re-rendering the joystick.

## Example: Custom Three-Way Selector

```javascript
const selector = createJoystick({
  directions: ['left', 'right', 'up'],
  labels: {
    left: 'Cancel',
    right: 'Maybe',
    up: 'Confirm'
  },
  onSelect: (direction) => {
    const actions = {
      left: () => closeDialog(),
      right: () => saveForLater(),
      up: () => confirmAction()
    }
    actions[direction]?.()
  }
})

document.getElementById('dialog').innerHTML = selector.render()
selector.attach(document.querySelector('.joystick-container'))
```

## Styling

The component uses CSS classes from `styles.css`:
- `.joystick-container` - Main container
- `.joystick-stage` - Fixed-size interaction area
- `.joystick-stick` - Draggable circular handle
- `.joystick-label` - Direction labels
- `.joystick-label-current` - The selected direction, shown at rest
- `.joystick-label-active` - The direction currently under the stick while dragging

All styles are already defined and will work out of the box.
